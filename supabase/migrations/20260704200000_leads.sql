-- ============================================================================
-- leads — internal record of free (non-paid) landing events
-- ============================================================================
-- Written only by the notify-lead Edge Function (service role). RLS-enabled with
-- NO policies (deny-all): anon/authenticated can never read or write it.
-- ============================================================================

create table if not exists leads (
  id         uuid primary key default gen_random_uuid(),
  type       text not null,               -- 'example_report' | 'domain_submitted'
  email      text,
  domain     text,
  lang       text,
  ip_hash    text,                         -- salted SHA-256 of the client IP (never raw)
  created_at timestamptz not null default now()
);

create index if not exists idx_leads_type       on leads (type);
create index if not exists idx_leads_created_at  on leads (created_at);

alter table leads enable row level security;
