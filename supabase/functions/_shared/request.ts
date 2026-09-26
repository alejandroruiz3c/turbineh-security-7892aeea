// Request helpers: client IP extraction + privacy-friendly IP hashing.

/** Best-effort client IP from the proxy headers (first hop of x-forwarded-for). */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip") ?? req.headers.get("cf-connecting-ip") ?? "unknown";
}

/**
 * Salted SHA-256 of an IP, hex. Store this in analytics — never the raw IP.
 * Uses the IP_HASH_SALT secret when set (rotating it anonymizes historical data).
 */
export async function hashIp(ip: string): Promise<string> {
  const salt = Deno.env.get("IP_HASH_SALT") ?? "turbineh-analytics-v1";
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
