-- ============================================================
-- BuildChain — Clean Slate for Live Testing
-- Run in Supabase SQL Editor (NOT a migration — run manually)
--
-- Deletes all test data while preserving:
--   • User accounts (auth.users)
--   • Profiles
--   • Any real lenders you've added manually
-- ============================================================

-- 1. Notifications (no FK cascade from draws)
DELETE FROM public.notifications
WHERE link LIKE '/admin/draws%' OR link LIKE '/lender/approvals%';

-- 2. Draw line items (FK → draw_requests)
DELETE FROM public.draw_line_items
WHERE draw_request_id IN (
  SELECT id FROM public.draw_requests
);

-- 3. Lien waivers (FK → draw_requests / projects)
DELETE FROM public.lien_waivers;

-- 4. Inspections (FK → draw_requests / projects)
DELETE FROM public.inspections;

-- 5. Draw requests (FK → projects, cascades from projects but let's be explicit)
DELETE FROM public.draw_requests;

-- 6. Budget line items (FK → projects)
DELETE FROM public.budget_line_items;

-- 7. Documents (FK → projects)
DELETE FROM public.documents;

-- 8. Projects (all test projects)
DELETE FROM public.projects;

-- 9. Borrowers provisioned by Building Block (placeholder records)
DELETE FROM public.borrowers
WHERE contact_name = 'GC-provisioned'
   OR email LIKE '%@%.example';

-- 10. Lenders provisioned by Building Block (placeholder records)
--     NOTE: only deletes BB-provisioned placeholders, not real lenders
DELETE FROM public.lenders
WHERE contact_name = 'GC-provisioned'
   OR email LIKE '%@%.example'
   OR company_name = 'N/A';

-- ── Verify clean state ────────────────────────────────────────
SELECT 'projects'       AS table_name, COUNT(*) AS remaining FROM public.projects
UNION ALL
SELECT 'draw_requests'  AS table_name, COUNT(*) AS remaining FROM public.draw_requests
UNION ALL
SELECT 'draw_line_items'AS table_name, COUNT(*) AS remaining FROM public.draw_line_items
UNION ALL
SELECT 'lien_waivers'   AS table_name, COUNT(*) AS remaining FROM public.lien_waivers
UNION ALL
SELECT 'inspections'    AS table_name, COUNT(*) AS remaining FROM public.inspections
UNION ALL
SELECT 'borrowers'      AS table_name, COUNT(*) AS remaining FROM public.borrowers
UNION ALL
SELECT 'lenders'        AS table_name, COUNT(*) AS remaining FROM public.lenders
UNION ALL
SELECT 'notifications'  AS table_name, COUNT(*) AS remaining FROM public.notifications;
