-- ============================================================
-- BuildChain Protocol — Seed Data
-- Run AFTER schema migration, in Supabase SQL Editor
-- Creates sample lenders, borrowers, projects, draws, docs
-- ============================================================

-- NOTE: Auth users must be created manually via Supabase Auth UI
-- or use the signup flow. These seed records assume profiles exist.
-- For demo purposes, insert directly if needed.

-- Sample Lenders
insert into public.lenders (id, company_name, contact_name, email, phone, loan_types, max_ltv) values
  ('11111111-1111-1111-1111-111111111111', 'First Western Bank', 'Sarah Jennings', 's.jennings@fwbank.com', '602-555-0101', ARRAY['residential','commercial'], 75.00),
  ('22222222-2222-2222-2222-222222222222', 'Desert Community CU', 'Marcus Webb', 'm.webb@desertcu.org', '480-555-0202', ARRAY['residential','adu'], 80.00)
on conflict do nothing;

-- Sample Borrowers
insert into public.borrowers (id, company_name, contact_name, email, phone, license_number, license_state, rating) values
  ('aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Mesa Builders LLC', 'Derek Malone', 'derek@mesabuilders.com', '480-555-0303', 'ROC-281745', 'AZ', 'preferred'),
  ('aaaaaaa2-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SunBelt Development', 'Priya Nair', 'priya@sunbeltdev.com', '602-555-0404', 'ROC-319022', 'AZ', 'new'),
  ('aaaaaaa3-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'AZ Contractors Inc', 'Tom Reyes', 'tom@azcontractors.com', '520-555-0505', 'ROC-204891', 'AZ', 'standard')
on conflict do nothing;

-- Sample Projects
insert into public.projects (id, name, address, city, state, zip, property_type, borrower_id, lender_id, loan_amount, amount_drawn, interest_rate, loan_number, maturity_date, stage, appraised_value) values
  ('proj0001-0000-0000-0000-000000000001', 'Scottsdale Custom Home', '8402 E Camelback Rd', 'Scottsdale', 'AZ', '85251', 'residential',
   'aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
   850000.00, 552500.00, 8.750, 'LN-2026-04', '2026-11-15', 'active', 1050000.00),
  ('proj0002-0000-0000-0000-000000000002', 'Tempe Multifamily (4 units)', '214 S Mill Ave', 'Tempe', 'AZ', '85281', 'multifamily',
   'aaaaaaa2-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222',
   1250000.00, 375000.00, 8.500, 'LN-2026-05', '2027-01-31', 'active', 1600000.00),
  ('proj0003-0000-0000-0000-000000000003', 'Chandler Commercial Buildout', '455 N Arizona Ave', 'Chandler', 'AZ', '85225', 'commercial',
   'aaaaaaa3-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
   450000.00, 0.00, 9.250, 'LN-2026-07', '2027-02-28', 'review', 590000.00),
  ('proj0004-0000-0000-0000-000000000004', 'Phoenix ADU', '1821 W McDowell Rd', 'Phoenix', 'AZ', '85009', 'adu',
   'aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222',
   185000.00, 0.00, 8.750, 'LN-2026-08', '2026-12-31', 'approved', 235000.00)
on conflict do nothing;

-- Sample Draw Requests
insert into public.draw_requests (id, project_id, request_number, amount, purpose, phase, description, status, inspection_done, lien_waiver, submitted_at, funded_at) values
  ('draw0001-0000-0000-0000-000000000001', 'proj0001-0000-0000-0000-000000000001', 'DR-2026-001', 85000.00, 'Foundation & Slab', 'Foundation / Slab', 'Poured foundation and slab per engineered plans.', 'funded', true, true, now() - interval '60 days', now() - interval '55 days'),
  ('draw0002-0000-0000-0000-000000000001', 'proj0001-0000-0000-0000-000000000001', 'DR-2026-002', 120000.00, 'Framing', 'Framing', 'Complete wall and roof framing.', 'funded', true, true, now() - interval '45 days', now() - interval '40 days'),
  ('draw0003-0000-0000-0000-000000000001', 'proj0001-0000-0000-0000-000000000001', 'DR-2026-003', 95000.00, 'MEP Rough-In', 'MEP Rough-In', 'Plumbing, electrical, and HVAC rough-in complete.', 'funded', true, true, now() - interval '30 days', now() - interval '25 days'),
  ('draw0004-0000-0000-0000-000000000001', 'proj0001-0000-0000-0000-000000000001', 'DR-2026-004', 62000.00, 'Roofing & Sheathing', 'Roofing', 'Roof sheathing and synthetic underlayment installed.', 'funded', true, true, now() - interval '20 days', now() - interval '15 days'),
  ('draw0005-0000-0000-0000-000000000001', 'proj0001-0000-0000-0000-000000000001', 'DR-2026-005', 52400.00, 'Framing & Sheathing', 'Framing', 'Wall sheathing and exterior wrap complete.', 'pending', true, true, now() - interval '2 days', null),
  ('draw0006-0000-0000-0000-000000000001', 'proj0001-0000-0000-0000-000000000001', 'DR-2026-006', 41200.00, 'Roofing', 'Roofing', 'Final roofing material installation.', 'pending', false, true, now() - interval '1 day', null),
  ('draw0007-0000-0000-0000-000000000002', 'proj0002-0000-0000-0000-000000000002', 'DR-2026-007', 38000.00, 'Site Prep', 'Site Preparation', 'Grading, excavation, and utility connections.', 'funded', true, true, now() - interval '15 days', now() - interval '10 days'),
  ('draw0008-0000-0000-0000-000000000002', 'proj0002-0000-0000-0000-000000000002', 'DR-2026-008', 87500.00, 'Foundation + Slab', 'Foundation / Slab', 'Foundation work for all 4 units.', 'pending', false, true, now() - interval '1 day', null)
on conflict do nothing;

-- Sample Documents
insert into public.documents (project_id, name, doc_type, status, required) values
  -- Scottsdale (proj0001)
  ('proj0001-0000-0000-0000-000000000001', 'Executed Loan Agreement', 'loan_agreement', 'approved', true),
  ('proj0001-0000-0000-0000-000000000001', 'Title Commitment', 'title_commitment', 'approved', true),
  ('proj0001-0000-0000-0000-000000000001', 'Approved Plans & Permits', 'plans_permits', 'approved', true),
  ('proj0001-0000-0000-0000-000000000001', 'Insurance Certificate', 'insurance', 'approved', true),
  ('proj0001-0000-0000-0000-000000000001', 'Inspection Report (Apr 28)', 'inspection_report', 'uploaded', true),
  -- Tempe Multifamily (proj0002)
  ('proj0002-0000-0000-0000-000000000002', 'Executed Loan Agreement', 'loan_agreement', 'approved', true),
  ('proj0002-0000-0000-0000-000000000002', 'Title Commitment', 'title_commitment', 'approved', true),
  ('proj0002-0000-0000-0000-000000000002', 'Approved Plans & Permits', 'plans_permits', 'approved', true),
  ('proj0002-0000-0000-0000-000000000002', 'Insurance Certificate', 'insurance', 'approved', true),
  ('proj0002-0000-0000-0000-000000000002', 'Phase 1 Inspection Report', 'inspection_report', 'required', true),
  -- Chandler Commercial (proj0003)
  ('proj0003-0000-0000-0000-000000000003', 'Executed Loan Agreement', 'loan_agreement', 'approved', true),
  ('proj0003-0000-0000-0000-000000000003', 'Title Commitment (Updated)', 'title_commitment', 'overdue', true),
  ('proj0003-0000-0000-0000-000000000003', 'Approved Plans & Permits', 'plans_permits', 'approved', true),
  ('proj0003-0000-0000-0000-000000000003', 'Insurance Certificate', 'insurance', 'approved', true),
  ('proj0003-0000-0000-0000-000000000003', 'Phase I Environmental Report', 'environmental', 'required', true),
  -- Phoenix ADU (proj0004)
  ('proj0004-0000-0000-0000-000000000004', 'Executed Loan Agreement', 'loan_agreement', 'approved', true),
  ('proj0004-0000-0000-0000-000000000004', 'Title Commitment', 'title_commitment', 'approved', true),
  ('proj0004-0000-0000-0000-000000000004', 'Approved Plans & Permits', 'plans_permits', 'approved', true),
  ('proj0004-0000-0000-0000-000000000004', 'Insurance Certificate', 'insurance', 'approved', true),
  ('proj0004-0000-0000-0000-000000000004', 'Signed Contractor Agreement', 'contractor_agreement', 'required', true),
  ('proj0004-0000-0000-0000-000000000004', 'Building Permit', 'plans_permits', 'required', true)
on conflict do nothing;
