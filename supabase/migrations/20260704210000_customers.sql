-- ============================================================================
-- customers — one canonical user per email (consistency)
-- ============================================================================
-- Rationale: an email may first appear as a FREE lead and later come back as a
-- PAYING customer. We must never create two users for the same email. So we make
-- `customers` the single source of truth for a user, keyed by a CASE-INSENSITIVE
-- unique email. A customer can own MANY domains/scans (1-to-many); whether each
-- domain is paid is tracked per scan (scan_requests.status / paid_at) — a domain
-- can exist with no linked user (free preview / domain lead) and still carry its
-- own paid state.
--
-- RLS deny-all (service-role only). Do NOT add public policies.
-- ============================================================================

create table if not exists customers (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  lang       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Case-insensitive uniqueness: one row per distinct email, regardless of case.
create unique index if not exists uq_customers_email_lower on customers (lower(email));

alter table customers enable row level security;

-- ---------------------------------------------------------------------------
-- Link the existing tables to a customer (nullable — domains can be user-less).
-- ---------------------------------------------------------------------------
alter table scan_requests add column if not exists customer_id uuid references customers (id) on delete set null;
alter table leads         add column if not exists customer_id uuid references customers (id) on delete set null;
alter table payments      add column if not exists customer_id uuid references customers (id) on delete set null;

create index if not exists idx_scan_requests_customer on scan_requests (customer_id);
create index if not exists idx_leads_customer         on leads (customer_id);
create index if not exists idx_payments_customer      on payments (customer_id);

-- ---------------------------------------------------------------------------
-- Atomic get-or-create by email (case-insensitive). Returns the customer id.
-- This is the ONLY way callers should attach a user — it guarantees no
-- duplicate users for the same email under concurrency.
-- ---------------------------------------------------------------------------
create or replace function get_or_create_customer(p_email text, p_lang text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    uuid;
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if v_email = '' then
    return null;
  end if;

  insert into customers (email, lang)
    values (v_email, p_lang)
  on conflict (lower(email)) do update
    set updated_at = now(),
        lang = coalesce(customers.lang, excluded.lang)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function get_or_create_customer(text, text) from public;
revoke all on function get_or_create_customer(text, text) from anon, authenticated;
grant execute on function get_or_create_customer(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Backfill: adopt any emails already present so existing data is consistent.
-- ---------------------------------------------------------------------------
insert into customers (email)
  select distinct lower(btrim(email))
  from scan_requests
  where email is not null and btrim(email) <> ''
on conflict (lower(email)) do nothing;

insert into customers (email)
  select distinct lower(btrim(customer_email))
  from payments
  where customer_email is not null and btrim(customer_email) <> ''
on conflict (lower(email)) do nothing;

insert into customers (email)
  select distinct lower(btrim(email))
  from leads
  where email is not null and btrim(email) <> ''
on conflict (lower(email)) do nothing;

update scan_requests s
  set customer_id = c.id
  from customers c
  where s.customer_id is null
    and s.email is not null
    and lower(btrim(s.email)) = c.email;

update payments p
  set customer_id = c.id
  from customers c
  where p.customer_id is null
    and p.customer_email is not null
    and lower(btrim(p.customer_email)) = c.email;

update leads l
  set customer_id = c.id
  from customers c
  where l.customer_id is null
    and l.email is not null
    and lower(btrim(l.email)) = c.email;
