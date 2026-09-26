// Shared domain parsing + validation for the Web Exposure Diagnosis backend.
//
// This module is intentionally dependency-free (pure string logic) so it can run
// identically in any Edge Function without network access.

/**
 * Normalize raw user input into a hostname.
 *
 * Examples:
 *   "https://www.midominio.com/x?y=1#z"  -> "midominio.com"
 *   "  WWW.Example.CO.UK/path  "         -> "example.co.uk"
 *   "sub.example.com"                    -> "sub.example.com" (subdomains kept)
 *
 * Note: we only strip a single leading "www." — other subdomains are preserved,
 * since they can matter for the diagnosis (e.g. shop.example.com).
 */
export function normalizeDomain(input: string): string {
  if (!input) return "";

  let s = input.trim().toLowerCase();

  // Strip scheme (http://, https://, ftp://, etc.)
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");

  // Strip any userinfo (user:pass@) before the host.
  s = s.replace(/^[^/@]*@/, "");

  // Cut everything from the first path / query / fragment separator.
  s = s.split(/[/?#]/)[0];

  // Drop a trailing port (":443").
  s = s.replace(/:\d+$/, "");

  // Strip a single leading "www.".
  s = s.replace(/^www\./, "");

  // Remove a trailing dot (FQDN root, "example.com.").
  s = s.replace(/\.$/, "");

  return s.trim();
}

export interface DomainValidation {
  ok: boolean;
  reason?: string;
}

// A single hostname label: 1–63 chars, alphanumeric or hyphen, no leading/
// trailing hyphen. (We keep it ASCII for now; punycoded IDNs pass as-is.)
const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
// domain = one-or-more labels + a dot + a TLD of at least 2 letters.
const DOMAIN_RE = new RegExp(`^(?:${LABEL}\\.)+[a-z]{2,}$`);

// IPv4 dotted-quad literal.
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * Validate a *normalized* domain. Reject anything that clearly isn't a public,
 * fetchable domain name.
 *
 * Rejects: empty, "localhost", IPv4/IPv6 literals, values containing spaces,
 * and anything that isn't a dotted domain with a plausible TLD.
 *
 * This is input validation only. All outbound requests must also use safeFetch,
 * which checks resolved addresses and redirects. See its DNS-rebinding limitation.
 */
export function validateDomain(domain: string): DomainValidation {
  if (!domain) return { ok: false, reason: "empty" };

  if (/\s/.test(domain)) return { ok: false, reason: "contains whitespace" };

  if (domain === "localhost" || domain.endsWith(".localhost")) {
    return { ok: false, reason: "localhost is not allowed" };
  }

  // Reject IPv4 literals (e.g. 127.0.0.1, 192.168.1.1).
  if (IPV4_RE.test(domain)) {
    return { ok: false, reason: "IP address literals are not allowed" };
  }

  // Reject IPv6 literals. These contain ":" (bare) or are wrapped in brackets.
  if (domain.includes(":") || domain.startsWith("[")) {
    return { ok: false, reason: "IP address literals are not allowed" };
  }

  if (domain.length > 253) {
    return { ok: false, reason: "domain is too long" };
  }

  if (!DOMAIN_RE.test(domain)) {
    return { ok: false, reason: "not a valid domain name" };
  }

  return { ok: true };
}
