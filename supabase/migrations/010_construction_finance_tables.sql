-- ============================================================
-- Migration 010 — Construction finance tables
--
-- Adds the core financial infrastructure missing from v1:
--   budget_line_items  — Schedule of Values (SOV) per project
--   draw_line_items    — G703 continuation sheet rows per draw
--   lien_waivers       — per-sub, per-draw waiver tracking
--   inspections        — third-party inspector sign-off per draw
--
-- Also adds retainage columns to the existing draw_requests table.
-- ============================================================

-- ── RETAINAGE on draw_requests ───────────────────────────────
-- retainage_rate: % held per lender policy (default 10%)
-- retainage_held: dollar amount withheld this draw
-- net_amount:     funds actually released (amount - retainage_held)
ALTER TABLE public.draw_requests
  ADD COLUMN IF NOT EXISTS retainage_rate  numeric(5,4) DEFAULT 0.10,
  ADD COLUMN IF NOT EXISTS retainage_held  numeric(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_amount      numeric(14,2);


-- ── BUDGET LINE ITEMS (Schedule of Values) ───────────────────
-- One row per cost category per project. Set up when the loan is created.
-- This is the approved budget the lender locked in at closing.
CREATE TABLE IF NOT EXISTS public.budget_line_items (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id      uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  line_no         text NOT NULL,          -- "1", "1.1", "2.3", etc.
  description     text NOT NULL,          -- "Foundation & Excavation"
  scheduled_value numeric(14,2) NOT NULL DEFAULT 0,
  csi_division    text,                   -- "03-300" Concrete (optional)
  trade           text,                   -- "Masonry", "MEP", etc.
  sort_order      integer DEFAULT 0,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE public.budget_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Role-based SOV access"
  ON public.budget_line_items FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    OR EXISTS (
      SELECT 1 FROM public.projects p
      JOIN public.lenders l ON l.id = p.lender_id
      WHERE p.id = project_id AND l.profile_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.projects p
      JOIN public.borrowers b ON b.id = p.borrower_id
      WHERE p.id = project_id AND b.profile_id = auth.uid()
    )
  );

-- Admins and borrowers can create/edit SOV; lenders read-only
CREATE POLICY "Admins and borrowers can manage SOV"
  ON public.budget_line_items FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'borrower'))
    OR EXISTS (
      SELECT 1 FROM public.projects p
      JOIN public.borrowers b ON b.id = p.borrower_id
      WHERE p.id = project_id AND b.profile_id = auth.uid()
    )
  );


-- ── DRAW LINE ITEMS (G703 continuation sheet) ────────────────
-- One row per SOV line per draw request.
-- Tracks cumulative work completed and amount due this period.
CREATE TABLE IF NOT EXISTS public.draw_line_items (
  id                      uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  draw_request_id         uuid NOT NULL REFERENCES public.draw_requests(id) ON DELETE CASCADE,
  budget_line_item_id     uuid NOT NULL REFERENCES public.budget_line_items(id),
  -- G703 columns
  work_completed_prev     numeric(14,2) DEFAULT 0,   -- col D: earned in prior draws
  work_completed_period   numeric(14,2) DEFAULT 0,   -- col E: earned this draw
  materials_stored        numeric(14,2) DEFAULT 0,   -- col F: materials on site
  total_completed_stored  numeric(14,2) DEFAULT 0,   -- col G: D + E + F
  percent_complete        numeric(5,2)  DEFAULT 0,   -- col H: G / scheduled_value
  balance_to_finish       numeric(14,2) DEFAULT 0,   -- col I: scheduled_value - G
  retainage_amount        numeric(14,2) DEFAULT 0,   -- col J: held this line
  current_payment_due     numeric(14,2) DEFAULT 0,   -- net due this period
  created_at              timestamptz DEFAULT now()
);

ALTER TABLE public.draw_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Role-based draw line item access"
  ON public.draw_line_items FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    OR EXISTS (
      SELECT 1 FROM public.draw_requests dr
      JOIN public.projects p ON p.id = dr.project_id
      JOIN public.lenders l ON l.id = p.lender_id
      WHERE dr.id = draw_request_id AND l.profile_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.draw_requests dr
      JOIN public.projects p ON p.id = dr.project_id
      JOIN public.borrowers b ON b.id = p.borrower_id
      WHERE dr.id = draw_request_id AND b.profile_id = auth.uid()
    )
  );

CREATE POLICY "Borrowers and admins can manage draw line items"
  ON public.draw_line_items FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    OR EXISTS (
      SELECT 1 FROM public.draw_requests dr
      JOIN public.projects p ON p.id = dr.project_id
      JOIN public.borrowers b ON b.id = p.borrower_id
      WHERE dr.id = draw_request_id AND b.profile_id = auth.uid()
    )
  );


-- ── LIEN WAIVERS ─────────────────────────────────────────────
-- Tracks conditional and unconditional waivers per sub per draw.
-- Conditional: submitted with the draw (promise to release lien on payment)
-- Unconditional: submitted after payment confirmed (actual lien release)
CREATE TABLE IF NOT EXISTS public.lien_waivers (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id      uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  draw_request_id uuid REFERENCES public.draw_requests(id),
  -- Subcontractor info (denormalized for portability)
  sub_name        text NOT NULL,
  sub_code        text,                   -- e.g. "SUB-201"
  trade           text,
  -- Waiver classification
  waiver_type     text NOT NULL CHECK (waiver_type IN (
    'conditional_partial',
    'conditional_final',
    'unconditional_partial',
    'unconditional_final'
  )),
  state           text DEFAULT 'TX',      -- statute scope
  statute_ref     text,                   -- e.g. "Tex. Prop. Code 53.281"
  -- Amounts
  through_amount  numeric(14,2) DEFAULT 0,   -- waiver covers work through this $
  payment_amount  numeric(14,2) DEFAULT 0,   -- for unconditional: actual payment received
  -- Status
  status          text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'signed', 'issued', 'void')
  ),
  signed_at       timestamptz,
  signed_by       text,
  pdf_path        text,                   -- Supabase storage path
  notes           text,
  -- Building Block linkage
  source          text DEFAULT 'manual' CHECK (source IN ('manual', 'building_block')),
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE public.lien_waivers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Role-based lien waiver access"
  ON public.lien_waivers FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    OR EXISTS (
      SELECT 1 FROM public.projects p
      JOIN public.lenders l ON l.id = p.lender_id
      WHERE p.id = project_id AND l.profile_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.projects p
      JOIN public.borrowers b ON b.id = p.borrower_id
      WHERE p.id = project_id AND b.profile_id = auth.uid()
    )
  );

CREATE POLICY "Admins and borrowers can manage lien waivers"
  ON public.lien_waivers FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    OR EXISTS (
      SELECT 1 FROM public.projects p
      JOIN public.borrowers b ON b.id = p.borrower_id
      WHERE p.id = project_id AND b.profile_id = auth.uid()
    )
  );


-- ── INSPECTIONS ──────────────────────────────────────────────
-- Third-party inspector sign-off before draw funds release.
-- Replaces the boolean `inspection_done` on draw_requests with
-- a full record including inspector identity, outcome, and report.
CREATE TABLE IF NOT EXISTS public.inspections (
  id                          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id                  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  draw_request_id             uuid REFERENCES public.draw_requests(id),
  -- Inspector identity
  inspector_name              text NOT NULL,
  inspector_company           text,
  inspector_email             text,
  -- Inspection result
  inspection_date             date NOT NULL,
  outcome                     text NOT NULL DEFAULT 'pending' CHECK (
    outcome IN ('pending', 'pass', 'pass_with_observations', 'fail')
  ),
  percent_complete_verified   numeric(5,2),  -- inspector's verified % complete
  -- Attachments
  report_path                 text,          -- Supabase storage path for PDF report
  photos_path                 text,          -- path prefix for photo uploads
  notes                       text,
  -- On-chain attestation (XRPL)
  on_chain_tx_hash            text,          -- XRPL tx hash recording this inspection
  -- Source
  source                      text DEFAULT 'manual' CHECK (source IN ('manual', 'building_block')),
  created_at                  timestamptz DEFAULT now(),
  updated_at                  timestamptz DEFAULT now()
);

ALTER TABLE public.inspections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Role-based inspection access"
  ON public.inspections FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    OR EXISTS (
      SELECT 1 FROM public.projects p
      JOIN public.lenders l ON l.id = p.lender_id
      WHERE p.id = project_id AND l.profile_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.projects p
      JOIN public.borrowers b ON b.id = p.borrower_id
      WHERE p.id = project_id AND b.profile_id = auth.uid()
    )
  );

CREATE POLICY "Admins can manage inspections"
  ON public.inspections FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );


-- ── GRANTS on new tables ─────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON public.budget_line_items TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.draw_line_items   TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.lien_waivers      TO authenticated;
GRANT SELECT                 ON public.inspections        TO authenticated;

GRANT ALL ON public.budget_line_items TO service_role;
GRANT ALL ON public.draw_line_items   TO service_role;
GRANT ALL ON public.lien_waivers      TO service_role;
GRANT ALL ON public.inspections       TO service_role;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
