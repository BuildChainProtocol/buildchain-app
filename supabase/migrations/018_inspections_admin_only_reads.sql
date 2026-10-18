-- Migration 018: only admins (and the service role) read inspections
--
-- The inspector portal (/api/inspections/[token]) now submits with the
-- service role, so the token in its link is the only credential for
-- recording an inspection result. The non-admin SELECT policies let a
-- project's lender or borrower read that token: 010's "Role-based inspection
-- access" in production, and 011's lender / borrower policies elsewhere. A
-- borrower could then pass their own draw's inspection.
--
-- Nothing outside the admin pages reads inspections (lender and borrower
-- pages use draw_requests.inspection_done). Admins keep everything through
-- "Admins can manage inspections" (010) or "Admins full access on
-- inspections" (011), and the portal, BB submit and the orchestrator use the
-- service role, so dropping these policies changes no screen.
-- Apply before deploying the service-role portal route.
-- Run once via: supabase db push  OR  paste into the Supabase SQL editor.

DROP POLICY IF EXISTS "Role-based inspection access" ON public.inspections;
DROP POLICY IF EXISTS "Lenders can view inspections on their projects" ON public.inspections;
DROP POLICY IF EXISTS "Borrowers can view inspections on their projects" ON public.inspections;
