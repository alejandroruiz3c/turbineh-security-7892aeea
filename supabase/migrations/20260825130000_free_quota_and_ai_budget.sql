-- ============================================================================
-- Phase 9b — free-tier guardrails: one report per verified email + daily AI cap
-- ============================================================================
-- The diagnosis is now free and public, so the two things that can hurt us are
-- (a) one person farming unlimited reports and (b) a traffic spike burning an
-- unbounded amount of AI money. This migration adds the two ledgers that make
-- both bounded, plus the atomic SQL functions that own the decisions.
--
-- SECURITY MODEL UNCHANGED: both tables are RLS-enabled with NO policies
-- (deny-all). Every function is SECURITY DEFINER and granted ONLY to
-- service_role, so the anon key can neither read the ledgers nor spend budget.
-- Do NOT add public policies.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- leads — the bottom-of-site CTA is now a real contact form, not just an email
-- ---------------------------------------------------------------------------
-- The 'turbineh_lead' type (book-a-call) collects name, phone, company and email,
-- all four required. Columns are nullable because the other lead types
-- ('domain_submitted', 'example_report', 'free_diagnosis') legitimately have no
-- name/phone/company — the NOT-NULL rule for turbineh_lead is enforced in the
-- notify-lead Edge Function, which is the only writer.
alter table leads add column if not exists name    text;
alter table leads add column if not exists phone   text;
alter table leads add column if not exists company text;


-- ---------------------------------------------------------------------------
-- Table: free_report_claims — "one free report per verified email", forever
-- ---------------------------------------------------------------------------
-- Keyed on the email the user actually PROVED control of (the address the 6-digit
-- code was sent to), not on whatever they typed into the landing form. That is
-- what makes the limit meaningful: passing it requires receiving mail at the
-- domain being scanned.
--
-- One row per email, for all time. A second attempt — same domain or a different
-- one — is refused. The row is deleted (freeing the quota) only when the run
-- fails and the user never got a report, or when we delete the scan ourselves.
create table if not exists free_report_claims (
  id                uuid primary key default gen_random_uuid(),
  email             text not null,                 -- the VERIFIED address, lowercased
  scan_request_id   uuid references scan_requests (id) on delete cascade,
  normalized_domain text,
  created_at        timestamptz not null default now()
);

-- The quota itself: case-insensitive, one claim per address.
create unique index if not exists uq_free_report_claims_email
  on free_report_claims (lower(email));

create index if not exists idx_free_report_claims_scan
  on free_report_claims (scan_request_id);

alter table free_report_claims enable row level security;


-- ---------------------------------------------------------------------------
-- Table: ai_spend — daily AI cost ledger (reservation + settlement)
-- ---------------------------------------------------------------------------
-- Every run RESERVES an estimated cost before calling the model, then SETTLES
-- the real cost once the report is stored. Reserving up front is the whole
-- point: without it, N concurrent runs would each read "budget is fine" and
-- collectively blow past the cap.
--
-- The day is Europe/Madrid, not UTC, because the user-facing message promises
-- availability again "a partir de las 00:00" — that has to mean midnight where
-- the customer is, not 02:00 local in summer.
create table if not exists ai_spend (
  id              uuid primary key default gen_random_uuid(),
  scan_request_id uuid unique references scan_requests (id) on delete cascade,
  spend_day       date not null,
  estimated_usd   numeric(10, 4) not null,
  actual_usd      numeric(10, 4),                  -- null until settled
  created_at      timestamptz not null default now(),
  settled_at      timestamptz
);

create index if not exists idx_ai_spend_day on ai_spend (spend_day);

alter table ai_spend enable row level security;


-- ---------------------------------------------------------------------------
-- The billing day (Europe/Madrid).
-- ---------------------------------------------------------------------------
create or replace function ai_budget_day()
returns date
language sql
stable
set search_path = public
as $$
  select (now() at time zone 'Europe/Madrid')::date;
$$;


-- ---------------------------------------------------------------------------
-- ai_budget_status — read-only view of today's spend. Used for the early
-- "system is at its daily limit" dialog, before we create anything.
-- ---------------------------------------------------------------------------
create or replace function ai_budget_status(p_cap numeric)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_day   date := ai_budget_day();
  v_spent numeric;
begin
  select coalesce(sum(coalesce(actual_usd, estimated_usd)), 0)
    into v_spent
    from ai_spend
   where spend_day = v_day;

  return jsonb_build_object(
    'day',       v_day,
    'spent',     round(v_spent, 4),
    'cap',       p_cap,
    'remaining', round(greatest(0, p_cap - v_spent), 4),
    'exhausted', v_spent >= p_cap
  );
end;
$$;


-- ---------------------------------------------------------------------------
-- reserve_ai_budget — atomically claim p_estimate of today's cap for a scan.
-- ---------------------------------------------------------------------------
-- Serialized on a transaction-scoped advisory lock so concurrent runs cannot
-- both pass the same remaining budget. Idempotent per scan: re-reserving an
-- already-reserved scan succeeds without double-charging.
create or replace function reserve_ai_budget(
  p_scan_request_id uuid,
  p_estimate        numeric,
  p_cap             numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day      date := ai_budget_day();
  v_spent    numeric;
  v_existing ai_spend;
begin
  perform pg_advisory_xact_lock(hashtext('ai_budget'));

  select * into v_existing
    from ai_spend
   where scan_request_id = p_scan_request_id;

  if found then
    return jsonb_build_object('allowed', true, 'reused', true, 'day', v_existing.spend_day);
  end if;

  select coalesce(sum(coalesce(actual_usd, estimated_usd)), 0)
    into v_spent
    from ai_spend
   where spend_day = v_day;

  if v_spent + p_estimate > p_cap then
    return jsonb_build_object(
      'allowed', false,
      'reason',  'daily_budget_reached',
      'day',     v_day,
      'spent',   round(v_spent, 4),
      'cap',     p_cap
    );
  end if;

  insert into ai_spend (scan_request_id, spend_day, estimated_usd)
    values (p_scan_request_id, v_day, p_estimate);

  return jsonb_build_object(
    'allowed', true,
    'reused',  false,
    'day',     v_day,
    'spent',   round(v_spent + p_estimate, 4),
    'cap',     p_cap
  );
end;
$$;


-- ---------------------------------------------------------------------------
-- settle_ai_spend — replace the estimate with the real cost once known.
-- ---------------------------------------------------------------------------
create or replace function settle_ai_spend(p_scan_request_id uuid, p_actual numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update ai_spend
     set actual_usd = greatest(0, coalesce(p_actual, 0)),
         settled_at = now()
   where scan_request_id = p_scan_request_id;
end;
$$;


-- ---------------------------------------------------------------------------
-- release_ai_budget — give the reservation back when a run never produced a
-- report. Without this, failed runs would silently eat the daily cap.
-- ---------------------------------------------------------------------------
create or replace function release_ai_budget(p_scan_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from ai_spend
   where scan_request_id = p_scan_request_id
     and settled_at is null;
end;
$$;


-- ---------------------------------------------------------------------------
-- claim_free_report — atomically take the one-report-per-email slot.
-- ---------------------------------------------------------------------------
-- Returns allowed=true only for the first ever claim by this address (or for a
-- repeat call by the SAME scan, so a retry is not punished). Otherwise returns
-- the domain and date of the report they already got, so the UI can say exactly
-- what happened.
create or replace function claim_free_report(
  p_email           text,
  p_scan_request_id uuid,
  p_domain          text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email    text := lower(btrim(coalesce(p_email, '')));
  v_id       uuid;
  v_existing free_report_claims;
begin
  if v_email = '' then
    return jsonb_build_object('allowed', false, 'reason', 'no_email');
  end if;

  insert into free_report_claims (email, scan_request_id, normalized_domain)
    values (v_email, p_scan_request_id, p_domain)
  on conflict (lower(email)) do nothing
  returning id into v_id;

  if v_id is not null then
    return jsonb_build_object('allowed', true, 'first', true, 'email', v_email);
  end if;

  select * into v_existing
    from free_report_claims
   where lower(email) = v_email;

  -- Same scan asking again (retry / duplicate click): not a new report.
  if v_existing.scan_request_id = p_scan_request_id then
    return jsonb_build_object('allowed', true, 'first', false, 'email', v_email);
  end if;

  return jsonb_build_object(
    'allowed',        false,
    'reason',         'already_claimed',
    'email',          v_email,
    'claimed_domain', v_existing.normalized_domain,
    'claimed_at',     v_existing.created_at
  );
end;
$$;


-- ---------------------------------------------------------------------------
-- release_free_report_claim — free the slot when the run did not deliver.
-- ---------------------------------------------------------------------------
create or replace function release_free_report_claim(p_scan_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from free_report_claims
   where scan_request_id = p_scan_request_id;
end;
$$;


-- ---------------------------------------------------------------------------
-- has_free_report_claim — read-only pre-check for the landing form, so we can
-- tell a returning user "you already used your free report" before creating
-- anything. Advisory only; claim_free_report is the authority.
-- ---------------------------------------------------------------------------
create or replace function has_free_report_claim(p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email    text := lower(btrim(coalesce(p_email, '')));
  v_existing free_report_claims;
begin
  if v_email = '' then
    return jsonb_build_object('claimed', false);
  end if;

  select * into v_existing
    from free_report_claims
   where lower(email) = v_email;

  if not found then
    return jsonb_build_object('claimed', false);
  end if;

  return jsonb_build_object(
    'claimed',        true,
    'claimed_domain', v_existing.normalized_domain,
    'claimed_at',     v_existing.created_at
  );
end;
$$;


-- ---------------------------------------------------------------------------
-- Lock every function down to service_role (Edge Functions only).
-- ---------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'ai_budget_day()',
    'ai_budget_status(numeric)',
    'reserve_ai_budget(uuid, numeric, numeric)',
    'settle_ai_spend(uuid, numeric)',
    'release_ai_budget(uuid)',
    'claim_free_report(text, uuid, text)',
    'release_free_report_claim(uuid)',
    'has_free_report_claim(text)'
  ]
  loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;


-- ---------------------------------------------------------------------------
-- Backfill: adopt reports that already exist so history is consistent.
-- ---------------------------------------------------------------------------
-- Existing completed reports consume their owner's one free slot (keyed on the
-- verified address when we have it, else the address on the scan), and their
-- real AI cost is booked against the day they completed.
insert into free_report_claims (email, scan_request_id, normalized_domain, created_at)
  select distinct on (lower(coalesce(dv.target_email, s.email)))
         lower(coalesce(dv.target_email, s.email)),
         s.id,
         s.normalized_domain,
         coalesce(r.completed_at, r.created_at)
    from diagnostic_reports r
    join scan_requests s on s.id = r.scan_request_id
    left join domain_verifications dv
           on dv.scan_request_id = s.id
          and dv.status = 'verified'
   where coalesce(dv.target_email, s.email) is not null
     and btrim(coalesce(dv.target_email, s.email)) <> ''
   order by lower(coalesce(dv.target_email, s.email)),
            coalesce(r.completed_at, r.created_at)
on conflict (lower(email)) do nothing;

-- completed_at can be null on very early rows, so fall back to created_at: the
-- day only needs to be historically plausible, and it must never be null.
insert into ai_spend (scan_request_id, spend_day, estimated_usd, actual_usd, created_at, settled_at)
  select r.scan_request_id,
         (coalesce(r.completed_at, r.created_at) at time zone 'Europe/Madrid')::date,
         coalesce(r.ai_cost, 0),
         coalesce(r.ai_cost, 0),
         coalesce(r.completed_at, r.created_at),
         coalesce(r.completed_at, r.created_at)
    from diagnostic_reports r
   where r.scan_request_id is not null
on conflict (scan_request_id) do nothing;
