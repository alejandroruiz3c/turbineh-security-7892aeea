-- ============================================================================
-- Phase 6 — Private "reports" storage bucket for generated PDFs
-- ============================================================================
-- One PDF per scan is stored at reports/{scanRequestId}.pdf. The bucket is
-- PRIVATE: public = false and we create NO policies on storage.objects for it,
-- so the anon/authenticated roles are denied by RLS. All access happens through
-- Edge Functions using the service-role key (which bypasses RLS) and via
-- short-lived signed URLs minted by createSignedUrl. Do NOT add public policies.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reports', 'reports', false, 10485760, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
