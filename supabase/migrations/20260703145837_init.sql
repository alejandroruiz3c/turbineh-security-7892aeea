-- ============================================================================
-- Web Exposure Diagnosis — Phase 2 initial schema
-- ============================================================================
-- SECURITY MODEL (read this first):
--   Row Level Security is ENABLED on all four tables below, and we create NO
--   policies. In Postgres, RLS-enabled + zero policies == deny-all for every
--   role that is subject to RLS (anon, authenticated). This means the Lovable
--   frontend, which talks to Supabase with the ANON key, can NEVER read or
--   write these tables directly.
--
--   ALL backend access happens through Supabase Edge Functions using the
--   SERVICE ROLE key. The service role BYPASSES RLS, so the functions can do
--   their work while the tables stay completely sealed off from the public API.
--
--   Do NOT add permissive policies here. If the frontend ever needs a field,
--   expose it through a dedicated Edge Function (see get-scan) that returns
--   only whitelisted, non-sensitive columns.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Enum: scan_status
-- ---------------------------------------------------------------------------
create type scan_status as enum (
  'preview',
  'pending_payment',
  'paid_pending_verification',
  'verification_failed',
  'verified',
  'processing',
  'completed',
  'failed',
  'expired'
);

-- ---------------------------------------------------------------------------
-- Shared: updated_at trigger function
-- ---------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Table: scan_requests
-- ---------------------------------------------------------------------------
create table scan_requests (
  id                      uuid primary key default gen_random_uuid(),
  domain                  text not null,                             -- raw user input
  normalized_domain       text not null,                            -- e.g. midominio.com
  email                   text,
  lang                    text not null default 'es',               -- 'es' | 'en'
  status                  scan_status not null default 'preview',
  preview_items           jsonb,
  stripe_session_id       text,
  stripe_customer_email   text,
  paid_at                 timestamptz,
  verification_status     text not null default 'pending',          -- pending|verified|failed
  verification_method     text,                                     -- dns_txt|html_file|meta_tag|email_domain
  verification_token      text,
  verified_at             timestamptz,
  verification_attempts   int not null default 0,
  report_consumed         boolean not null default false,
  report_consumed_at      timestamptz,
  last_verification_error text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index idx_scan_requests_normalized_domain on scan_requests (normalized_domain);
create index idx_scan_requests_status            on scan_requests (status);
create index idx_scan_requests_stripe_session_id on scan_requests (stripe_session_id);

create trigger trg_scan_requests_updated_at
  before update on scan_requests
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Table: domain_verifications
-- ---------------------------------------------------------------------------
create table domain_verifications (
  id               uuid primary key default gen_random_uuid(),
  scan_request_id  uuid not null references scan_requests (id) on delete cascade,
  domain           text not null,
  method           text not null,                                     -- dns_txt|html_file
  token            text not null,
  expected_value   text not null,
  status           text not null default 'pending',                  -- pending|verified|failed
  attempts         int not null default 0,
  last_error       text,
  verified_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index idx_domain_verifications_scan_request_id on domain_verifications (scan_request_id);

create trigger trg_domain_verifications_updated_at
  before update on domain_verifications
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Table: payments
-- ---------------------------------------------------------------------------
create table payments (
  id                 uuid primary key default gen_random_uuid(),
  scan_request_id    uuid references scan_requests (id) on delete set null,
  stripe_session_id  text,
  amount             integer,                                         -- cents, e.g. 9900
  currency           text not null default 'eur',
  payment_status     text,                                            -- 'paid' | 'mock_paid'
  customer_email     text,
  is_mock            boolean not null default false,                  -- true for the dev bypass
  created_at         timestamptz not null default now()
);

create index idx_payments_scan_request_id on payments (scan_request_id);

-- ---------------------------------------------------------------------------
-- Table: diagnostic_reports
-- ---------------------------------------------------------------------------
create table diagnostic_reports (
  id                 uuid primary key default gen_random_uuid(),
  scan_request_id    uuid not null unique references scan_requests (id) on delete cascade,
  domain             text not null,
  lang               text not null default 'es',
  overall_score      int,
  risk_level         text,
  executive_summary  text,
  findings_json      jsonb,
  action_plan_json   jsonb,
  ai_prompts_json    jsonb,
  model_used         text,                                            -- e.g. claude-fable-5
  ai_cost            numeric,
  pdf_url            text,
  completed_at       timestamptz,
  created_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row Level Security: enable on all tables, create NO policies (deny-all).
-- See the SECURITY MODEL note at the top of this file.
-- ---------------------------------------------------------------------------
alter table scan_requests        enable row level security;
alter table domain_verifications enable row level security;
alter table payments             enable row level security;
alter table diagnostic_reports   enable row level security;
