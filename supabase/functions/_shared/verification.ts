// Shared crypto helpers for the email-at-the-domain verification flow.
//
// The 6-digit code is NEVER stored in plaintext. We store a per-row random salt
// (in the verification row's `token` column) and a salted SHA-256 hash of the
// code (in `expected_value`). Verification re-hashes the submitted code with the
// stored salt and compares in constant time.

/** Cryptographically-random 6-digit numeric code, zero-padded (e.g. "042317"). */
export function generateSixDigitCode(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  // Modulo bias over 2^32 for a 10^6 range is negligible for a one-time code.
  const n = buf[0] % 1_000_000;
  return n.toString().padStart(6, "0");
}

/** Random hex salt (default 16 bytes → 32 hex chars). */
export function randomSaltHex(bytes = 16): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Lowercase hex SHA-256 of a string. */
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Salted hash of a code: SHA-256(salt + ":" + code), lowercase hex. */
export function hashCode(salt: string, code: string): Promise<string> {
  return sha256Hex(`${salt}:${code}`);
}

/** Constant-time string comparison (avoids timing side-channels on the hash). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
