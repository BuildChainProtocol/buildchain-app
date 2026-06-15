-- ============================================================
-- Migration 006 — Profile auto-linking for invited users
--
-- When an admin invites a lender or borrower via
-- supabase.auth.admin.inviteUserByEmail(email, { data: { role: 'lender' } })
-- this trigger will:
-- 1. Create the profiles row with the correct role
-- 2. Auto-link the matching lenders/borrowers row by email
-- ============================================================

-- Replace the existing handle_new_user trigger function
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  v_role TEXT;
BEGIN
  -- Extract role from invite metadata (set by the admin invite API call)
  v_role := COALESCE(NEW.raw_user_meta_data->>'role', 'borrower');

  -- Create the profiles row
  INSERT INTO public.profiles (id, email, role, full_name, company_name)
  VALUES (
    NEW.id,
    NEW.email,
    v_role,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'company_name', '')
  )
  ON CONFLICT (id) DO NOTHING;

  -- Auto-link lenders row by email match
  IF v_role = 'lender' THEN
    UPDATE public.lenders
    SET profile_id = NEW.id
    WHERE email = NEW.email
      AND profile_id IS NULL;
  END IF;

  -- Auto-link borrowers row by email match
  IF v_role = 'borrower' THEN
    UPDATE public.borrowers
    SET profile_id = NEW.id
    WHERE email = NEW.email
      AND profile_id IS NULL;
  END IF;

  -- Admins: no lender/borrower row to link
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- The trigger itself doesn't change — it already exists on auth.users
-- But recreating to be safe in case of schema changes:
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- ── Back-fill: link any existing users who already have matching emails ──────
-- Run this once to fix existing unlinked rows (safe to run multiple times)
UPDATE public.lenders l
SET profile_id = p.id
FROM public.profiles p
WHERE p.email = l.email
  AND l.profile_id IS NULL
  AND p.role = 'lender';

UPDATE public.borrowers b
SET profile_id = p.id
FROM public.profiles p
WHERE p.email = b.email
  AND b.profile_id IS NULL
  AND p.role = 'borrower';
