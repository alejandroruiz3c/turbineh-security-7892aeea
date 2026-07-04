-- ============================================================================
-- Phase 3 — Email-at-the-domain verification
-- ============================================================================
-- Adds the two columns the email_domain verification flow needs and a uniqueness
-- guarantee so each scan has at most ONE verification row per method (which lets
-- send-verification-code upsert deterministically on re-sends).
--
-- SECURITY MODEL UNCHANGED: domain_verifications still has RLS enabled with NO
-- policies (deny-all). Adding columns/indexes does not create any policy, so the
-- anon/authenticated roles still cannot read or write this table. All access
-- remains through Edge Functions using the service-role key. Do NOT add policies.
-- ============================================================================

-- The full email address the 6-digit code was sent to (e.g. admin@theirdomain.com).
alter table domain_verifications
  add column if not exists target_email text;

-- When the current code expires. Codes are single-use, short-lived (~20 min).
alter table domain_verifications
  add column if not exists expires_at timestamptz;

-- Rate-limiting bookkeeping for send-verification-code (kept separate from the
-- verify `attempts` counter, which resets on every fresh send):
--   last_sent_at            — timestamp of the most recent code send (60s cooldown)
--   send_window_started_at  — start of the current rolling hour window
--   send_count              — sends within the current window (cap: 5 per hour)
alter table domain_verifications
  add column if not exists last_sent_at timestamptz;

alter table domain_verifications
  add column if not exists send_window_started_at timestamptz;

alter table domain_verifications
  add column if not exists send_count int not null default 0;

-- One verification row per (scan, method). send-verification-code upserts on this
-- so re-sending a code updates the existing row instead of piling up new ones.
create unique index if not exists uq_domain_verifications_scan_method
  on domain_verifications (scan_request_id, method);
