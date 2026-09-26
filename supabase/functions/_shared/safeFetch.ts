// SSRF-safe outbound HTTP for the external diagnostic engine.
// ---------------------------------------------------------------------------
// EVERY outbound request to a user-controlled domain MUST go through safeFetch.
// Guarantees:
//   * http/https only, GET/HEAD only.
//   * The host is resolved (DNS-over-HTTPS) and EVERY resolved A/AAAA address is
//     checked against a blocklist of private / loopback / link-local / CGNAT /
//     multicast / reserved / cloud-metadata ranges. If ANY resolved address is
//     forbidden (or the name doesn't resolve), the request is refused.
//   * Redirects are handled MANUALLY and every hop is re-validated (a redirect
//     to http://169.254.169.254 or http://localhost is caught).
//   * Per-request timeout (AbortController) and a hard response-body size cap.
//   * A fixed, honest User-Agent.
//
// KNOWN LIMITATION (documented, accepted for a non-invasive GET/HEAD scanner):
// there is a small TOCTOU / DNS-rebinding window because Deno's fetch() re-does
// its own DNS resolution when it connects, which could in theory differ from the
// address we validated. We mitigate by validating on every hop and never sending
// credentials or bodies to scanned hosts. Pinning the socket to the validated IP
// for TLS is not possible with the stable runtime API, so we accept this gap.

const USER_AGENT = "TurbineHSecurityScanner/1.0 (+external non-invasive diagnostic)";

const DEFAULT_TIMEOUT_MS = 6000;
const DEFAULT_MAX_BYTES = 512 * 1024; // 512 KiB
const DEFAULT_MAX_REDIRECTS = 4;

// ---------------------------------------------------------------------------
// IP parsing + blocklist
// ---------------------------------------------------------------------------

/** Parse a dotted-quad IPv4 string into 4 octets, or null. */
export function parseIPv4(s: string): number[] | null {
  const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1, 5).map((x) => Number(x));
  if (parts.some((n) => n < 0 || n > 255)) return null;
  return parts;
}

/** Parse an IPv6 string into 16 bytes (handles "::" and trailing IPv4), or null. */
export function parseIPv6(input: string): number[] | null {
  let s = input;
  // Strip a zone id ("%eth0") if present.
  const pct = s.indexOf("%");
  if (pct >= 0) s = s.slice(0, pct);
  if (!s.includes(":")) return null;

  // Split off a trailing embedded IPv4 (e.g. ::ffff:1.2.3.4).
  let tailBytes: number[] = [];
  const lastColon = s.lastIndexOf(":");
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIPv4(tail);
    if (!v4) return null;
    tailBytes = v4;
    s = s.slice(0, lastColon + 1) + "0:0"; // placeholder, replaced below
  }

  const halves = s.split("::");
  if (halves.length > 2) return null;

  const toGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const groups = part.split(":");
    const out: number[] = [];
    for (const g of groups) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };

  const head = toGroups(halves[0]);
  const rest = toGroups(halves.length === 2 ? halves[1] : "");
  if (head === null || rest === null) return null;

  let groups: number[];
  if (halves.length === 2) {
    const missing = 8 - (head.length + rest.length);
    if (missing <= 0) return null;
    groups = [...head, ...Array(missing).fill(0), ...rest];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;

  const bytes: number[] = [];
  for (const g of groups) {
    bytes.push((g >> 8) & 0xff, g & 0xff);
  }
  // If we had an embedded IPv4, overwrite the last 4 bytes with it.
  if (tailBytes.length === 4) {
    bytes[12] = tailBytes[0];
    bytes[13] = tailBytes[1];
    bytes[14] = tailBytes[2];
    bytes[15] = tailBytes[3];
  }
  return bytes;
}

function ipv4Forbidden(p: number[]): boolean {
  const [a, b] = p;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local (incl. 169.254.169.254 metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 192 && b === 0 && p[2] === 0) return true; // 192.0.0.0/24
  if (a === 192 && b === 0 && p[2] === 2) return true; // TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && p[2] === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && p[2] === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast (224/4) + reserved (240/4) + broadcast
  return false;
}

function ipv6Forbidden(b: number[]): boolean {
  // Only native global-unicast destinations are supported. Refuse translation,
  // mapped, deprecated and transition mechanisms instead of trusting embedded IPs.
  if ((b[0] & 0xe0) !== 0x20) return true; // outside 2000::/3
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] < 2) return true; // protocol assignments
  if (b[0] === 0x20 && b[1] === 0x02) return true; // 6to4
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true;
  if (b[0] === 0x3f && b[1] === 0xff && (b[2] & 0xf0) === 0) return true; // documentation

  return false;
}

/** True if the given IP literal is in a forbidden range (fail-closed on parse error). */
export function isForbiddenIp(ip: string): boolean {
  const v4 = parseIPv4(ip);
  if (v4) return ipv4Forbidden(v4);
  const v6 = parseIPv6(ip);
  if (v6) return ipv6Forbidden(v6);
  return true; // unparseable → treat as forbidden
}

// ---------------------------------------------------------------------------
// DNS over HTTPS (Cloudflare primary, Google fallback)
// ---------------------------------------------------------------------------

const DNS_TYPE: Record<string, number> = { A: 1, AAAA: 28, MX: 15, TXT: 16 };

interface DohAnswer {
  name: string;
  type: number;
  data: string;
}

/**
 * Query DNS-over-HTTPS. Returns the raw answer `data` strings for the requested
 * type (order preserved). Never throws — returns [] on failure and sets .error.
 * The DoH endpoints themselves are fixed, trusted public hosts, so they don't go
 * through the IP guard.
 */
export async function dohQuery(
  name: string,
  type: keyof typeof DNS_TYPE,
): Promise<{ answers: string[]; error?: string }> {
  const endpoints = [
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
    `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`,
  ];
  const wantType = DNS_TYPE[type];
  for (const url of endpoints) {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), DEFAULT_TIMEOUT_MS);
      const res = await fetch(url, {
        headers: { accept: "application/dns-json" },
        signal: ac.signal,
      });
      clearTimeout(t);
      if (!res.ok) continue;
      const json = (await res.json()) as { Answer?: DohAnswer[] };
      const answers = (json.Answer ?? []).filter((a) => a.type === wantType).map((a) => a.data);
      return { answers };
    } catch (_e) {
      // try next endpoint
    }
  }
  return { answers: [], error: "doh_failed" };
}

/** Resolve a host's A + AAAA addresses via DoH. */
export async function resolveHostIps(host: string): Promise<{ ips: string[]; error?: string }> {
  // Already an IP literal? Return as-is.
  if (parseIPv4(host) || parseIPv6(host.replace(/^\[|\]$/g, ""))) {
    return { ips: [host.replace(/^\[|\]$/g, "")] };
  }
  const [a, aaaa] = await Promise.all([dohQuery(host, "A"), dohQuery(host, "AAAA")]);
  const ips = [...a.answers, ...aaaa.answers].filter(Boolean);
  if (ips.length === 0) return { ips: [], error: "dns_no_records" };
  return { ips };
}

// ---------------------------------------------------------------------------
// Host / URL validation
// ---------------------------------------------------------------------------

export interface HostValidation {
  ok: boolean;
  reason?: string;
  ips?: string[];
}

/** Validate a URL: protocol must be http/https, and every resolved IP must be public. */
export async function validateUrlSafe(urlStr: string): Promise<HostValidation> {
  let u: URL;
  try {
    u = new URL(urlStr);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, reason: "forbidden_protocol" };
  }
  const host = u.hostname;
  const { ips, error } = await resolveHostIps(host);
  if (error || ips.length === 0) {
    return { ok: false, reason: error ?? "dns_no_records" };
  }
  for (const ip of ips) {
    if (isForbiddenIp(ip)) {
      return { ok: false, reason: "blocked_ip", ips };
    }
  }
  return { ok: true, ips };
}

// ---------------------------------------------------------------------------
// safeFetch
// ---------------------------------------------------------------------------

export interface SafeFetchOptions {
  method?: "GET" | "HEAD";
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  extraHeaders?: Record<string, string>;
  /** External AbortSignal (e.g. the engine's overall time budget). */
  signal?: AbortSignal;
}

export interface SafeFetchResult {
  ok: boolean;
  status?: number;
  finalUrl?: string;
  requestedUrl: string;
  headers?: Headers;
  bodyText?: string;
  truncated?: boolean;
  /** Present when the terminal response was itself a redirect (not followed). */
  location?: string | null;
  redirectChain: { from: string; status: number; to: string }[];
  ips?: string[];
  error?: string;
  detail?: string;
}

async function readBodyCapped(
  res: Response,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) return { text: "", truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (received + value.length > maxBytes) {
        chunks.push(value.slice(0, maxBytes - received));
        truncated = true;
        try {
          await reader.cancel();
        } catch (_e) {
          /* ignore */
        }
        break;
      }
      chunks.push(value);
      received += value.length;
    }
  } catch (_e) {
    // Partial body is fine; return what we have.
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const buf = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    buf.set(c, o);
    o += c.length;
  }
  return { text: new TextDecoder().decode(buf), truncated };
}

/**
 * SSRF-safe fetch. Follows up to maxRedirects hops (each re-validated). If the
 * terminal response is still a redirect (maxRedirects reached, or maxRedirects=0),
 * it is returned as-is with `location` populated (not treated as an error).
 */
export async function safeFetch(
  urlStr: string,
  opts: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const method = opts.method ?? "GET";
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

  if (method !== "GET" && method !== "HEAD") {
    return { ok: false, requestedUrl: urlStr, redirectChain: [], error: "forbidden_method" };
  }

  let currentUrl = urlStr;
  const chain: { from: string; status: number; to: string }[] = [];
  let lastIps: string[] | undefined;

  for (let i = 0; i <= maxRedirects; i++) {
    const v = await validateUrlSafe(currentUrl);
    if (!v.ok) {
      return {
        ok: false,
        requestedUrl: currentUrl,
        redirectChain: chain,
        error: v.reason,
        ips: v.ips,
      };
    }
    lastIps = v.ips;

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    // Chain the external budget signal if given.
    const onAbort = () => ac.abort();
    if (opts.signal) {
      if (opts.signal.aborted) ac.abort();
      else opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    let res: Response;
    try {
      res = await fetch(currentUrl, {
        method,
        redirect: "manual",
        signal: ac.signal,
        headers: { "User-Agent": USER_AGENT, ...(opts.extraHeaders ?? {}) },
      });
    } catch (e) {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      const aborted = (e as Error)?.name === "AbortError";
      return {
        ok: false,
        requestedUrl: currentUrl,
        redirectChain: chain,
        error: aborted ? "timeout" : "fetch_error",
        detail: String((e as Error)?.message ?? e).slice(0, 200),
        ips: lastIps,
      };
    }
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);

    const location = res.headers.get("location");
    const isRedirect = res.status >= 300 && res.status < 400 && !!location;

    if (isRedirect && i < maxRedirects) {
      let nextUrl: string;
      try {
        nextUrl = new URL(location!, currentUrl).toString();
      } catch {
        // Unparseable Location — return the redirect terminally.
        try {
          await res.body?.cancel();
        } catch (_e) {
          /* ignore */
        }
        return {
          ok: true,
          status: res.status,
          finalUrl: currentUrl,
          requestedUrl: urlStr,
          headers: res.headers,
          location,
          redirectChain: chain,
          ips: lastIps,
        };
      }
      chain.push({ from: currentUrl, status: res.status, to: nextUrl });
      try {
        await res.body?.cancel();
      } catch (_e) {
        /* ignore */
      }
      currentUrl = nextUrl;
      continue;
    }

    // Terminal response (may be a redirect we chose not to follow).
    let bodyText = "";
    let truncated = false;
    if (method === "GET" && !isRedirect) {
      const r = await readBodyCapped(res, maxBytes);
      bodyText = r.text;
      truncated = r.truncated;
    } else {
      try {
        await res.body?.cancel();
      } catch (_e) {
        /* ignore */
      }
    }

    return {
      ok: true,
      status: res.status,
      finalUrl: currentUrl,
      requestedUrl: urlStr,
      headers: res.headers,
      bodyText,
      truncated,
      location: isRedirect ? location : null,
      redirectChain: chain,
      ips: lastIps,
    };
  }

  return {
    ok: false,
    requestedUrl: urlStr,
    redirectChain: chain,
    error: "too_many_redirects",
  };
}

export { USER_AGENT };
