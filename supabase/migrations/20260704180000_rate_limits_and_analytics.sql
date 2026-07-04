-- ============================================================================
-- Phase 7 — Rate limiting + privacy-friendly analytics (public-deploy hardening)
-- ============================================================================
-- Both tables are RLS-enabled with NO policies (deny-all): the anon/authenticated
-- roles can never read or write them. Access is only via Edge Functions using the
-- service-role key. Do NOT add public policies.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- rate_limits: one row per (identifier, action), a fixed-window counter.
-- ---------------------------------------------------------------------------
create table if not exists rate_limits (
  identifier   text not null,
  action       text not null,
  count        int not null default 0,
  window_start timestamptz not null default now(),
  primary key (identifier, action)
);

alter table rate_limits enable row level security;

-- Atomic check-and-increment. Returns TRUE when the request is allowed (i.e. the
-- post-increment count for the current window is <= p_limit). SECURITY DEFINER so
-- it runs as the owner; only the service role is granted EXECUTE.
create or replace function check_rate_limit(
  p_identifier text,
  p_action     text,
  p_limit      int,
  p_window_sec int
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  insert into rate_limits (identifier, action, count, window_start)
    values (p_identifier, p_action, 1, now())
  on conflict (identifier, action) do update
    set count = case
                  when rate_limits.window_start < now() - make_interval(secs => p_window_sec)
                  then 1
                  else rate_limits.count + 1
                end,
        window_start = case
                  when rate_limits.window_start < now() - make_interval(secs => p_window_sec)
                  then now()
                  else rate_limits.window_start
                end
  returning count into v_count;

  return v_count <= p_limit;
end;
$$;

revoke all on function check_rate_limit(text, text, int, int) from public;
revoke all on function check_rate_limit(text, text, int, int) from anon, authenticated;
grant execute on function check_rate_limit(text, text, int, int) to service_role;

-- ---------------------------------------------------------------------------
-- analytics_events: privacy-friendly product analytics. IP is stored HASHED
-- (never raw). scan_request_id is nullable (many events are pre-scan).
-- ---------------------------------------------------------------------------
create table if not exists analytics_events (
  id              uuid primary key default gen_random_uuid(),
  event_type      text not null,
  scan_request_id uuid references scan_requests (id) on delete set null,
  lang            text,
  meta            jsonb,
  ip_hash         text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_analytics_events_type       on analytics_events (event_type);
create index if not exists idx_analytics_events_created_at  on analytics_events (created_at);
create index if not exists idx_analytics_events_scan        on analytics_events (scan_request_id);

alter table analytics_events enable row level security;
