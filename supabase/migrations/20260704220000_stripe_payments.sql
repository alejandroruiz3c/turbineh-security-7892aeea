-- ============================================================================
-- Phase 8 — Real Stripe payment lifecycle + 7-day recovery + webhook idempotency
-- ============================================================================
-- RLS deny-all everywhere (service-role only). Do NOT add public policies.
-- ============================================================================

-- --- scan_requests: recovery-campaign bookkeeping ---------------------------
alter table scan_requests add column if not exists recovery_emails_sent    int not null default 0;
alter table scan_requests add column if not exists last_recovery_email_at   timestamptz;
alter table scan_requests add column if not exists recovery_stopped         boolean not null default false;

-- Helps the recovery query (unpaid, not stopped, recent).
create index if not exists idx_scan_requests_recovery
  on scan_requests (status, recovery_stopped, created_at);

-- --- payments: full Stripe lifecycle ----------------------------------------
-- (stripe_session_id, amount, currency, payment_status, customer_email already exist.)
alter table payments add column if not exists stripe_payment_intent text;
alter table payments add column if not exists failure_reason        text;
alter table payments add column if not exists paid_at               timestamptz;

create index if not exists idx_payments_stripe_session on payments (stripe_session_id);

-- payment_status values in use: 'pending' | 'paid' | 'failed' | 'expired'
--   (plus the legacy dev value 'mock_paid'). Kept as free text for flexibility.

-- --- stripe_events: webhook idempotency -------------------------------------
-- A row here means "we already handled this Stripe event id" — never twice.
create table if not exists stripe_events (
  event_id   text primary key,
  type       text,
  created_at timestamptz not null default now()
);

alter table stripe_events enable row level security;

-- ---------------------------------------------------------------------------
-- claim_recovery_email: atomically reserve the next recovery-email slot for a
-- scan (race-free between the immediate retry and the daily cron). Returns the
-- scan's data + the NEW recovery_emails_sent when a slot was claimed, otherwise
-- no rows. Also flips recovery_stopped=true once the 7-email / 7-day cap is hit.
--   p_min_gap_secs  minimum gap since the last recovery email (~24h)
--   p_max_emails    hard cap on emails sent (7)
--   p_max_age_days  stop recovering scans older than this (7)
-- Eligibility: status='pending_payment' (never paid), not stopped, has an email,
-- under the caps, within the age window, and past the min gap.
-- ---------------------------------------------------------------------------
create or replace function claim_recovery_email(
  p_scan_id       uuid,
  p_min_gap_secs  int,
  p_max_emails    int,
  p_max_age_days  int
)
returns table (
  id                    uuid,
  email                 text,
  normalized_domain     text,
  lang                  text,
  recovery_emails_sent  int
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update scan_requests s
    set recovery_emails_sent  = s.recovery_emails_sent + 1,
        last_recovery_email_at = now(),
        recovery_stopped =
          ((s.recovery_emails_sent + 1) >= p_max_emails)
          or (s.created_at < now() - make_interval(days => p_max_age_days))
  where s.id = p_scan_id
    and s.status = 'pending_payment'
    and s.recovery_stopped = false
    and s.email is not null and btrim(s.email) <> ''
    and s.recovery_emails_sent < p_max_emails
    and s.created_at >= now() - make_interval(days => p_max_age_days)
    and (s.last_recovery_email_at is null
         or s.last_recovery_email_at < now() - make_interval(secs => p_min_gap_secs))
  returning s.id, s.email, s.normalized_domain, s.lang, s.recovery_emails_sent;
end;
$$;

revoke all on function claim_recovery_email(uuid, int, int, int) from public;
revoke all on function claim_recovery_email(uuid, int, int, int) from anon, authenticated;
grant execute on function claim_recovery_email(uuid, int, int, int) to service_role;
