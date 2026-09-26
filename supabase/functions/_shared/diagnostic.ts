// External, NON-INVASIVE diagnostic engine.
// ---------------------------------------------------------------------------
// Collects passive, externally-observable signals about a domain using ONLY
// plain GET/HEAD requests (all through safeFetch → SSRF-guarded) plus DNS-over-
// HTTPS lookups. There is NO exploitation, brute force, fuzzing, auth, injection
// or port scanning. Path checks use a FIXED allowlist only.
//
// Every value in raw_findings is either a REAL observation or null (+ optional
// note). We NEVER guess or fabricate — the downstream AI report phase must only
// speak to things actually observed. Anything that couldn't run is recorded in
// errors[] and/or as null with a note.
//
// Budget: <= MAX_REQUESTS requests to the target, concurrency <= CONCURRENCY,
// per-request timeout ~6s, overall wall-clock <= TIME_BUDGET_MS (abort
// gracefully and keep whatever was collected).

import { safeFetch, dohQuery, USER_AGENT } from "./safeFetch.ts";

const MAX_REQUESTS = 20;
const CONCURRENCY = 4;
const TIME_BUDGET_MS = 30_000;
const PER_REQUEST_TIMEOUT_MS = 6_000;

// The ONLY paths we are allowed to probe. Never extend or fuzz this at runtime.
const EXPOSED_PATH_ALLOWLIST = [
  "/wp-admin/",
  "/wp-login.php",
  "/administrator/",
  "/admin/",
  "/.git/",
  "/.env",
  "/server-status",
  "/phpinfo.php",
] as const;

const SCHEMA_VERSION = 1;

type HeaderField = { present: boolean; value: string | null };

function hdr(headers: Headers | undefined, name: string): HeaderField {
  const v = headers?.get(name) ?? null;
  return { present: v !== null, value: v };
}

function parseCookies(
  headers: Headers | undefined,
): { name: string; secure: boolean; httponly: boolean; samesite: string | null }[] {
  if (!headers) return [];
  let raw: string[] = [];
  // Deno exposes getSetCookie(); fall back to a single combined header.
  const anyH = headers as unknown as { getSetCookie?: () => string[] };
  if (typeof anyH.getSetCookie === "function") {
    raw = anyH.getSetCookie();
  } else {
    const sc = headers.get("set-cookie");
    if (sc) raw = [sc];
  }
  return raw.map((c) => {
    const parts = c.split(";").map((s) => s.trim());
    const name = parts[0].split("=")[0];
    const attrs = parts.slice(1);
    const lower = attrs.map((s) => s.toLowerCase());
    const ss = attrs.find((s) => /^samesite=/i.test(s));
    return {
      name,
      secure: lower.includes("secure"),
      httponly: lower.includes("httponly"),
      samesite: ss ? ss.split("=")[1] : null,
    };
  });
}

function metaGenerator(html: string): string | null {
  const tag = html.match(/<meta[^>]+name=["']generator["'][^>]*>/i);
  if (!tag) return null;
  const c = tag[0].match(/content=["']([^"']*)["']/i);
  return c ? c[1] : null;
}

function detectTech(
  server: string | null,
  xPoweredBy: string | null,
  generator: string | null,
): string[] {
  const out: string[] = [];
  const add = (x: string) => {
    if (!out.includes(x)) out.push(x);
  };
  const test = (v: string | null, re: RegExp, label: string) => {
    if (v && re.test(v)) add(label);
  };
  test(server, /nginx/i, "nginx");
  test(server, /apache/i, "Apache");
  test(server, /cloudflare/i, "Cloudflare");
  test(server, /litespeed/i, "LiteSpeed");
  test(server, /microsoft-iis/i, "IIS");
  test(server, /caddy/i, "Caddy");
  test(xPoweredBy, /php/i, "PHP");
  test(xPoweredBy, /express/i, "Express");
  test(xPoweredBy, /asp\.net/i, "ASP.NET");
  test(xPoweredBy, /next\.js/i, "Next.js");
  test(generator, /wordpress/i, "WordPress");
  test(generator, /wix/i, "Wix");
  test(generator, /shopify/i, "Shopify");
  test(generator, /drupal/i, "Drupal");
  test(generator, /joomla/i, "Joomla");
  test(generator, /squarespace/i, "Squarespace");
  return out;
}

/** Concurrency-limited map. */
async function pool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  const worker = async () => {
    while (true) {
      const i = idx++;
      if (i >= items.length) break;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export async function runDiagnostic(normalizedDomain: string) {
  const scannedAt = new Date().toISOString();
  const t0 = Date.now();
  const deadline = t0 + TIME_BUDGET_MS;
  const overallAc = new AbortController();
  const timeTimer = setTimeout(() => overallAc.abort(), TIME_BUDGET_MS);

  let used = 0;
  let dohUsed = 0;
  const errors: { section: string; reason: string }[] = [];
  const timeLeft = () => deadline - Date.now();

  // Guarded, budgeted request to the TARGET domain. DoH lookups are tracked
  // separately (they hit fixed trusted resolvers, not the target).
  const req = async (
    url: string,
    o: { method?: "GET" | "HEAD"; maxBytes?: number; maxRedirects?: number } = {},
  ) => {
    if (used >= MAX_REQUESTS) {
      return {
        ok: false as const,
        error: "budget_exhausted",
        requestedUrl: url,
        redirectChain: [],
      };
    }
    if (timeLeft() <= 250) {
      return {
        ok: false as const,
        error: "time_budget_exceeded",
        requestedUrl: url,
        redirectChain: [],
      };
    }
    used++;
    return await safeFetch(url, {
      method: o.method ?? "GET",
      maxBytes: o.maxBytes,
      maxRedirects: o.maxRedirects,
      timeoutMs: Math.min(PER_REQUEST_TIMEOUT_MS, Math.max(1000, timeLeft())),
      signal: overallAc.signal,
    });
  };

  const doh = async (name: string, type: "A" | "AAAA" | "MX" | "TXT") => {
    dohUsed++;
    return await dohQuery(name, type);
  };

  // ---- Homepage (https first, http fallback) -------------------------------
  const httpsHome = await req(`https://${normalizedDomain}/`, {
    method: "GET",
    maxRedirects: 4,
  });
  let homepage = httpsHome;
  const httpsReachable = httpsHome.ok;
  if (!httpsHome.ok) {
    errors.push({ section: "https", reason: httpsHome.error ?? "unreachable" });
    const httpHome = await req(`http://${normalizedDomain}/`, {
      method: "GET",
      maxRedirects: 4,
    });
    if (httpHome.ok) homepage = httpHome;
  }
  const homeHeaders = homepage.ok ? homepage.headers : undefined;
  const homeBody = homepage.ok ? (homepage.bodyText ?? "") : "";

  // ---- http -> https redirect behaviour ------------------------------------
  let httpToHttps: string | null = null;
  const httpProbe = await req(`http://${normalizedDomain}/`, {
    method: "HEAD",
    maxRedirects: 0,
  });
  if (httpProbe.ok) {
    if (httpProbe.status && httpProbe.status >= 300 && httpProbe.status < 400) {
      const loc = httpProbe.location ?? "";
      httpToHttps = /^https:\/\//i.test(loc) ? "redirects_to_https" : "redirects_non_https";
    } else if (httpProbe.status && httpProbe.status < 300) {
      httpToHttps = "serves_http_no_redirect";
    } else {
      httpToHttps = "other";
    }
  } else {
    errors.push({ section: "http_redirect", reason: httpProbe.error ?? "unknown" });
  }

  const https = {
    reachable: httpsReachable,
    http_to_https_redirect: httpToHttps,
    final_url: homepage.ok ? (homepage.finalUrl ?? null) : null,
    status: homepage.ok ? (homepage.status ?? null) : null,
    note: httpsReachable
      ? null
      : "HTTPS homepage was not reachable; values reflect HTTP fallback where available.",
  };

  // ---- tls ------------------------------------------------------------------
  // Deno's fetch() does not expose peer certificate details, so we can only
  // infer that the TLS handshake was ACCEPTED (a successful HTTPS response).
  const tls = {
    accepted: httpsReachable ? true : httpsHome.error === "timeout" ? null : false,
    issuer: null,
    not_after: null,
    hostname_match: httpsReachable ? true : null,
    note:
      "Runtime (Deno fetch) does not expose certificate issuer/expiry; " +
      "TLS acceptance is inferred from a successful HTTPS handshake. " +
      (httpsReachable ? "" : `HTTPS error: ${httpsHome.error ?? "unknown"}.`),
  };

  // ---- headers --------------------------------------------------------------
  const headers = {
    hsts: hdr(homeHeaders, "strict-transport-security"),
    content_security_policy: hdr(homeHeaders, "content-security-policy"),
    x_frame_options: hdr(homeHeaders, "x-frame-options"),
    x_content_type_options: hdr(homeHeaders, "x-content-type-options"),
    referrer_policy: hdr(homeHeaders, "referrer-policy"),
    permissions_policy: hdr(homeHeaders, "permissions-policy"),
    server: hdr(homeHeaders, "server"),
    x_powered_by: hdr(homeHeaders, "x-powered-by"),
  };
  if (!homepage.ok) {
    errors.push({ section: "headers", reason: "homepage_unreachable" });
  }

  // ---- cookies --------------------------------------------------------------
  const cookies = parseCookies(homeHeaders);

  // ---- dns (DoH) ------------------------------------------------------------
  const [aRec, aaaaRec, mxRec] = await Promise.all([
    doh(normalizedDomain, "A"),
    doh(normalizedDomain, "AAAA"),
    doh(normalizedDomain, "MX"),
  ]);
  const dns = {
    a: aRec.answers,
    aaaa: aaaaRec.answers,
    mx: mxRec.answers,
    note: aRec.error || aaaaRec.error || mxRec.error ? "one or more DoH lookups failed" : null,
  };
  if (aRec.error) errors.push({ section: "dns", reason: `A:${aRec.error}` });

  // ---- email (SPF / DMARC / DKIM) ------------------------------------------
  const [txtRoot, txtDmarc] = await Promise.all([
    doh(normalizedDomain, "TXT"),
    doh(`_dmarc.${normalizedDomain}`, "TXT"),
  ]);
  const unquote = (s: string) => s.replace(/^"|"$/g, "").replace(/"\s*"/g, "");
  const spfRec = txtRoot.answers.map(unquote).find((r) => /^v=spf1/i.test(r)) ?? null;
  const dmarcRec = txtDmarc.answers.map(unquote).find((r) => /^v=DMARC1/i.test(r)) ?? null;
  const dmarcPolicy = dmarcRec ? (dmarcRec.match(/\bp=([a-z]+)/i)?.[1] ?? null) : null;
  const email = {
    spf: { present: spfRec !== null, value: spfRec },
    dmarc: { present: dmarcRec !== null, policy: dmarcPolicy, value: dmarcRec },
    dkim: {
      checkable: false,
      note:
        "DKIM requires a selector published by the sender; it cannot be checked " +
        "externally without guessing selectors, which would be invasive. Skipped.",
    },
  };

  // ---- exposed_paths (FIXED allowlist, presence only) ----------------------
  const exposed_paths = await pool(EXPOSED_PATH_ALLOWLIST, CONCURRENCY, async (path) => {
    const r = await req(`https://${normalizedDomain}${path}`, {
      method: "GET",
      maxBytes: 16 * 1024,
      maxRedirects: 0,
    });
    if (!r.ok) {
      return { path, method: "GET", status: null, note: r.error ?? "error" };
    }
    return {
      path,
      method: "GET",
      status: r.status ?? null,
      note: r.location ? `redirect -> ${r.location}` : null,
      // Keep a tiny body only for wp-login CMS signal (not stored raw).
      _body: path === "/wp-login.php" ? (r.bodyText ?? "") : undefined,
    } as {
      path: string;
      method: string;
      status: number | null;
      note: string | null;
      _body?: string;
    };
  });
  const wpLogin = exposed_paths.find((p) => p.path === "/wp-login.php");
  const wpLoginBody = (wpLogin as { _body?: string })?._body ?? "";
  // Strip the internal _body before it goes into raw_findings.
  for (const p of exposed_paths) delete (p as { _body?: string })._body;

  // ---- tech -----------------------------------------------------------------
  const serverVal = headers.server.value;
  const xpbVal = headers.x_powered_by.value;
  const generator = homepage.ok ? metaGenerator(homeBody) : null;
  const tech = {
    server: serverVal,
    x_powered_by: xpbVal,
    generator,
    detected: detectTech(serverVal, xpbVal, generator),
  };

  // ---- cms ------------------------------------------------------------------
  let cms;
  if (generator && /wordpress/i.test(generator)) {
    cms = { detected: true, name: "WordPress", signal: "generator meta tag", note: null };
  } else if (generator && /(wix|shopify|drupal|joomla|squarespace)/i.test(generator)) {
    const name = generator.match(/(wix|shopify|drupal|joomla|squarespace)/i)![1];
    cms = { detected: true, name, signal: "generator meta tag", note: null };
  } else if (
    wpLogin &&
    wpLogin.status === 200 &&
    /(user_login|wp-submit|loginform)/i.test(wpLoginBody)
  ) {
    cms = {
      detected: true,
      name: "WordPress",
      signal: "/wp-login.php returns a login page (HTTP 200)",
      note: null,
    };
  } else {
    cms = {
      detected: false,
      name: null,
      signal: null,
      note: homepage.ok
        ? "no CMS fingerprint in generator meta or allowlisted paths"
        : "homepage unreachable",
    };
  }

  // ---- robots.txt -----------------------------------------------------------
  const robotsResp = await req(`https://${normalizedDomain}/robots.txt`, {
    method: "GET",
    maxBytes: 64 * 1024,
    maxRedirects: 2,
  });
  let robots;
  if (robotsResp.ok && robotsResp.status === 200) {
    const body = robotsResp.bodyText ?? "";
    const disallow = (body.match(/^\s*disallow:\s*\S+/gim) ?? []).length;
    robots = {
      present: true,
      disallow_count: disallow,
      url: `https://${normalizedDomain}/robots.txt`,
    };
  } else {
    robots = {
      present: robotsResp.ok ? false : null,
      disallow_count: null,
      url: null,
      note: robotsResp.ok ? `status ${robotsResp.status}` : (robotsResp.error ?? "error"),
    };
  }

  // ---- sitemap.xml ----------------------------------------------------------
  const sitemapResp = await req(`https://${normalizedDomain}/sitemap.xml`, {
    method: "HEAD",
    maxRedirects: 2,
  });
  let sitemap;
  if (sitemapResp.ok && sitemapResp.status === 200) {
    sitemap = { present: true, url: `https://${normalizedDomain}/sitemap.xml` };
  } else {
    sitemap = {
      present: sitemapResp.ok ? false : null,
      url: null,
      note: sitemapResp.ok ? `status ${sitemapResp.status}` : (sitemapResp.error ?? "error"),
    };
  }

  // ---- forms (homepage only) ------------------------------------------------
  let forms;
  if (homepage.ok) {
    const count = (homeBody.match(/<form\b/gi) ?? []).length;
    const hasPassword = /<input[^>]+type=["']?password["']?/i.test(homeBody);
    forms = {
      count,
      has_password_field: hasPassword,
      note: homepage.truncated
        ? "homepage body was truncated at the size cap; counts may be partial"
        : null,
    };
  } else {
    forms = { count: null, has_password_field: null, note: "homepage unreachable" };
  }

  clearTimeout(timeTimer);
  const elapsed = Date.now() - t0;
  const aborted = overallAc.signal.aborted;
  if (aborted) errors.push({ section: "engine", reason: "time_budget_exceeded" });

  return {
    schema_version: SCHEMA_VERSION,
    normalized_domain: normalizedDomain,
    scanned_at: scannedAt,
    user_agent: USER_AGENT,
    budget: {
      max_requests: MAX_REQUESTS,
      used_requests: used,
      max_concurrency: CONCURRENCY,
      doh_queries: dohUsed,
      time_budget_ms: TIME_BUDGET_MS,
      elapsed_ms: elapsed,
      aborted,
    },
    https,
    tls,
    headers,
    cookies,
    dns,
    email,
    tech,
    cms,
    robots,
    sitemap,
    forms,
    exposed_paths,
    errors,
  };
}
