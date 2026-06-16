-- ============================================================
-- Migration 009 — GRANT Audit
--
-- Supabase creates tables with grants to anon and authenticated
-- roles by default, but it's better to be explicit, especially
-- for sensitive tables. This migration:
--   1. Revokes broad anon access on all sensitive tables
--   2. Confirms explicit authenticated grants
--   3. Restricts notifications INSERT to service_role only
--      (server-side code runs as service_role and bypasses RLS,
--       so this prevents any browser client from injecting
--       notifications for arbitrary user_ids)
-- ============================================================

-- ── REVOKE anon access on sensitive tables ──────────────────
-- anon role should never read financial or PII data
REVOKE ALL ON public.projects       FROM anon;
REVOKE ALL ON public.draw_requests  FROM anon;
REVOKE ALL ON public.documents      FROM anon;
REVOKE ALL ON public.lenders        FROM anon;
REVOKE ALL ON public.borrowers      FROM anon;
REVOKE ALL ON public.notifications  FROM anon;
REVOKE ALL ON public.activity_log   FROM anon;
-- profiles: anon needs nothing; login uses auth.users not profiles
REVOKE ALL ON public.profiles       FROM anon;

-- ── GRANT authenticated role explicit permissions ───────────
-- (Supabase default grants these, but being explicit is safer)
GRANT SELECT, INSERT, UPDATE        ON public.profiles      TO authenticated;
GRANT SELECT                        ON public.lenders       TO authenticated;
GRANT SELECT                        ON public.borrowers     TO authenticated;
GRANT SELECT                        ON public.projects      TO authenticated;
GRANT SELECT, INSERT, UPDATE        ON public.draw_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE        ON public.documents     TO authenticated;
GRANT SELECT                        ON public.activity_log  TO authenticated;
GRANT SELECT, UPDATE                ON public.notifications TO authenticated;
-- NOTE: No INSERT on notifications for authenticated — only service_role
-- inserts notifications (server-side API routes that run as service_role)

-- ── GRANT service_role full access (bypasses RLS anyway) ────
GRANT ALL ON public.notifications   TO service_role;
GRANT ALL ON public.activity_log    TO service_role;
GRANT ALL ON public.projects        TO service_role;
GRANT ALL ON public.draw_requests   TO service_role;
GRANT ALL ON public.documents       TO service_role;
GRANT ALL ON public.lenders         TO service_role;
GRANT ALL ON public.borrowers       TO service_role;
GRANT ALL ON public.profiles        TO service_role;

-- ── SEQUENCES (needed for INSERT with serial PKs) ───────────
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
