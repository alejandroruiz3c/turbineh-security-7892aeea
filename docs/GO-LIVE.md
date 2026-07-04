# GO-LIVE checklist — security.turbineh.com

Public launch **in MOCK mode** (before Stripe). The paid unlock is still the
`mock-unlock` function, kept alive but double-gated. This file is the pre-launch
and at-launch checklist. Phase references: **Fase 8 = Stripe**.

---

## ✅ Done for this launch (Fase 7 hardening)

- [x] **Mock unlock double-gated.** `mock-unlock` requires BOTH `DEV_BYPASS_PAYMENT=true`
      AND a matching `BYPASS_SECRET` (header `x-bypass-secret` or body `bypassSecret`,
      constant-time compare). Without the secret it returns an opaque `403 {"error":"Not found"}`.
      Public visitors can browse the landing + free preview but **cannot** trigger a paid scan.
- [x] **CORS locked down.** `Access-Control-Allow-Origin` is reflected only for
      `https://security.turbineh.com`, `*.lovable.app/.lovableproject.com/.lovable.dev`
      (QA), and anything in the optional `ALLOWED_ORIGINS` secret. Every other origin
      gets the production origin back (never `*`). Applied to all Edge Functions.
- [x] **RLS deny-all** on every table (`scan_requests`, `domain_verifications`,
      `payments`, `diagnostic_reports`, `rate_limits`, `analytics_events`) — anon/authenticated
      cannot read/write; all access is service-role via Edge Functions.
- [x] **Storage private.** The `reports` bucket is `public=false` with no policies —
      access only via service role + short-lived (1h) signed URLs. Public path 400s.
- [x] **Rate limiting live** (`rate_limits` table + atomic `check_rate_limit()` SQL fn),
      applied by IP / email-domain / scan:
      - `send-verification-code`: 60s cooldown + 5/hour per scan **+ 30/day per IP + 10/day per domain**
      - `verify-domain`: 10/min per (scan+IP) (+ stored 6-attempt lock)
      - `start-diagnostic`: 20/day per IP (+ idempotent)
      - `generate-pdf`: 30/hour per (scan+IP)
      - `track-event`: 300/hour per IP (drops silently over cap)
      - report viewing/downloads are intentionally NOT throttled into uselessness.
- [x] **Analytics privacy.** `track-event` stores a **salted SHA-256 IP hash** (`IP_HASH_SALT`),
      never the raw IP. `analytics_events` is RLS deny-all.
- [x] **noindex.** `src/routes/__root.tsx` robots meta = `noindex,nofollow` while in mock mode.
- [x] **Secrets never committed.** Keys file (`KEYS_TURBINEH-SECURITY.rtf`) is gitignored
      (`KEYS_*`, `*.rtf`) and has **0** history entries. All secrets live in Supabase secrets.
- [x] **Deliverability config** for `turbineh.com` (sender `verificacion@turbineh.com`):
      SPF ✓, DKIM ✓ (`resend._domainkey`, aligned `d=turbineh.com`), DMARC present.
      Verification-code + report emails both report `delivered` via Resend.

Secrets set in Supabase: `BYPASS_SECRET`, `SITE_URL=https://security.turbineh.com`,
`IP_HASH_SALT`, plus existing `DEV_BYPASS_PAYMENT`, `AI_API_KEY`, `AI_MODEL`,
`RESEND_API_KEY`, `FROM_EMAIL`. (Optional: `ALLOWED_ORIGINS` for extra QA origins.)

---

## ⏳ Before flipping to production DNS / announcing

- [ ] **Custom-domain DNS records** for `security.turbineh.com` that Lovable requires
      (CNAME / A / TXT) — **PENDING**: the exact records were not provided. Add them in the
      IONOS `turbineh.com` zone, then verify they resolve and Lovable shows the domain as
      verified + SSL issued.
- [ ] **IONOS API key.** The key in the keys file has no `prefix.secret` format and is
      rejected by the IONOS DNS API — replace with a full `publicprefix.secret` key to let
      us push DNS changes programmatically.
- [ ] **Strengthen DMARC** (recommended): `turbineh.com` DMARC is `p=none` (monitor-only,
      via CNAME to `dmarc.ionos.es`). Move to `p=quarantine` (then `p=reject`) with a
      `rua=` reporting address for stronger anti-spoofing. Auth already passes, so this is
      a reputation/anti-spoof upgrade, not a delivery blocker.
- [ ] **Deliverability inbox check.** Confirm the verification-code and report emails land
      in **INBOX** (not spam) on Gmail **and Outlook** (the live folder check couldn't be
      automated this run). Emails are `delivered` with full SPF/DKIM/DMARC alignment, so
      inbox is expected — verify and, if any land in spam, warm up / adjust the sender.

---

## 🚀 At real launch (Fase 8 — Stripe)

- [ ] **Remove the mock bypass.** Unset `DEV_BYPASS_PAYMENT` and `BYPASS_SECRET` in the
      production Supabase env. `mock-unlock` is then dead (returns 403). Replace the unlock
      path with the Stripe checkout + webhook flow.
- [ ] **Remove noindex.** In `src/routes/__root.tsx` revert the robots meta to
      `index,follow,max-image-preview:large,max-snippet:-1`.
- [ ] Re-confirm CORS is still pinned to `https://security.turbineh.com` (drop the Lovable
      preview origins if no longer needed for QA).
- [ ] Re-confirm rate limits, RLS deny-all, and private storage are intact after the Stripe changes.
- [ ] Keys file still gitignored + never committed; secrets only in Supabase.
