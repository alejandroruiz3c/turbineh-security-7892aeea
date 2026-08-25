-- ============================================================================
-- Phase 9c — keep the contact details the diagnosis form already collects
-- ============================================================================
-- The landing form requires name, phone, company and email before it will start
-- a diagnosis, and sends all four. Until now the backend only kept the email and
-- silently dropped the rest, so the best-qualified leads in the funnel arrived
-- without a way to call them back. These are the canonical identity of a person,
-- so they belong on `customers` (one row per email), not on each scan.
--
-- RLS deny-all is unchanged; the helper is SECURITY DEFINER, service_role only.
-- ============================================================================

alter table customers add column if not exists name    text;
alter table customers add column if not exists phone   text;
alter table customers add column if not exists company text;


-- ---------------------------------------------------------------------------
-- upsert_customer_contact — fill in contact details without ever losing data.
-- ---------------------------------------------------------------------------
-- Deliberately additive: a blank incoming value never overwrites a stored one
-- (coalesce(nullif(...))), so a later submission with a half-filled form cannot
-- erase a phone number we already had. A non-blank value DOES win, so people can
-- correct a typo by submitting again.
--
-- Kept as a separate function rather than extending get_or_create_customer:
-- overloading that one would make the existing two-argument named-parameter
-- calls in notify-lead ambiguous.
create or replace function upsert_customer_contact(
  p_customer_id uuid,
  p_name        text default null,
  p_phone       text default null,
  p_company     text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_customer_id is null then
    return;
  end if;

  update customers
     set name       = coalesce(nullif(btrim(coalesce(p_name, '')), ''), name),
         phone      = coalesce(nullif(btrim(coalesce(p_phone, '')), ''), phone),
         company    = coalesce(nullif(btrim(coalesce(p_company, '')), ''), company),
         updated_at = now()
   where id = p_customer_id;
end;
$$;

revoke all on function upsert_customer_contact(uuid, text, text, text) from public;
revoke all on function upsert_customer_contact(uuid, text, text, text) from anon, authenticated;
grant execute on function upsert_customer_contact(uuid, text, text, text) to service_role;


-- ---------------------------------------------------------------------------
-- Backfill: adopt anything the leads table already captured.
-- ---------------------------------------------------------------------------
-- 'turbineh_lead' rows carry name/phone/company for people who may also have run
-- a diagnosis, so seed customers from the most recent lead that has each field.
update customers c
   set name       = coalesce(c.name, l.name),
       phone      = coalesce(c.phone, l.phone),
       company    = coalesce(c.company, l.company)
  from (
    select distinct on (lower(email))
           lower(email) as email, name, phone, company
      from leads
     where email is not null
       and (name is not null or phone is not null or company is not null)
     order by lower(email), created_at desc
  ) l
 where lower(c.email) = l.email;
