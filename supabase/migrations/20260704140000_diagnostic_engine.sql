-- ============================================================================
-- Phase 4 — External non-invasive diagnostic engine
-- ============================================================================
-- Stores the structured, externally-observed signals collected by the engine on
-- scan_requests, plus timing for the background run.
--
-- SECURITY MODEL UNCHANGED: scan_requests still has RLS enabled with NO policies
-- (deny-all). Adding columns creates no policy. All access remains via Edge
-- Functions using the service-role key. Do NOT add policies. raw_findings is
-- exposed to the frontend only through a dedicated whitelisting function later,
-- never directly.
-- ============================================================================

alter table scan_requests
  add column if not exists raw_findings jsonb;

alter table scan_requests
  add column if not exists diagnostic_started_at timestamptz;

alter table scan_requests
  add column if not exists diagnostic_completed_at timestamptz;
