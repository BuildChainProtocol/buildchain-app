-- ============================================================
-- Migration 008 — Tighten RLS policies for data isolation
--
-- Problem: The original schema used "all authenticated" SELECT
-- policies on projects, draws, documents, and activity_log.
-- This means a lender could query another lender's loans, or
-- a borrower could see draws on projects they aren't party to.
--
-- Fix: Replace broad "all authenticated" SELECT policies with
-- role-specific policies:
--   admins  → see everything
--   lenders → see only their own projects + related data
--   borrowers → see only their own projects + related data
-- ============================================================

-- ── PROJECTS ────────────────────────────────────────────────
DROP POLICY IF EXISTS "All authenticated can view projects" ON public.projects;

CREATE POLICY "Role-based project access"
  ON public.projects FOR SELECT USING (
    -- Admins see all projects
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    OR
    -- Lenders see projects where they are the lender
    EXISTS (SELECT 1 FROM public.lenders l WHERE l.id = lender_id AND l.profile_id = auth.uid())
    OR
    -- Borrowers see projects where they are the borrower
    EXISTS (SELECT 1 FROM public.borrowers b WHERE b.id = borrower_id AND b.profile_id = auth.uid())
  );

-- Remove the now-redundant separate lender/borrower SELECT policies
-- (they're now combined in the policy above)
DROP POLICY IF EXISTS "Lenders can view their projects" ON public.projects;
DROP POLICY IF EXISTS "Borrowers can view their projects" ON public.projects;

-- ── DRAW REQUESTS ───────────────────────────────────────────
DROP POLICY IF EXISTS "All authenticated can view draws" ON public.draw_requests;

CREATE POLICY "Role-based draw access"
  ON public.draw_requests FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    OR
    EXISTS (
      SELECT 1 FROM public.projects p
      JOIN public.lenders l ON l.id = p.lender_id
      WHERE p.id = project_id AND l.profile_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM public.projects p
      JOIN public.borrowers b ON b.id = p.borrower_id
      WHERE p.id = project_id AND b.profile_id = auth.uid()
    )
  );

-- Lenders should only be able to update draws on THEIR projects
DROP POLICY IF EXISTS "Admins and lenders can update draws" ON public.draw_requests;

CREATE POLICY "Admins and lenders can update draws"
  ON public.draw_requests FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    OR
    EXISTS (
      SELECT 1 FROM public.projects p
      JOIN public.lenders l ON l.id = p.lender_id
      WHERE p.id = project_id AND l.profile_id = auth.uid()
    )
  );

-- ── DOCUMENTS ───────────────────────────────────────────────
DROP POLICY IF EXISTS "All authenticated can view documents" ON public.documents;

CREATE POLICY "Role-based document access"
  ON public.documents FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    OR
    EXISTS (
      SELECT 1 FROM public.projects p
      JOIN public.lenders l ON l.id = p.lender_id
      WHERE p.id = project_id AND l.profile_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM public.projects p
      JOIN public.borrowers b ON b.id = p.borrower_id
      WHERE p.id = project_id AND b.profile_id = auth.uid()
    )
  );

-- ── ACTIVITY LOG ────────────────────────────────────────────
DROP POLICY IF EXISTS "All authenticated can view activity" ON public.activity_log;

CREATE POLICY "Role-based activity access"
  ON public.activity_log FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    OR
    EXISTS (
      SELECT 1 FROM public.projects p
      JOIN public.lenders l ON l.id = p.lender_id
      WHERE p.id = project_id AND l.profile_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM public.projects p
      JOIN public.borrowers b ON b.id = p.borrower_id
      WHERE p.id = project_id AND b.profile_id = auth.uid()
    )
  );
