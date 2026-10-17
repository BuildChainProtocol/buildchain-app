-- Migration 016: the public anon key can no longer read inspections
--
-- 011's "Token holders can read their inspection" policy is using (true) for
-- every role, and Supabase grants anon on new tables by default. Together
-- they let anyone holding the public anon key list every inspection: portal
-- tokens, inspector names and emails. Any signed-in account could too.
--
-- The inspector portal (/api/inspections/[token]) now looks tokens up with
-- the service role, so nothing needs the open policy or anon access. Admins,
-- lenders and borrowers keep their own policies from 011.
--
-- Apply this before deploying the service-role portal route: while tokens
-- are listable, that route would let anyone holding one submit a result.
-- Run once via: supabase db push  OR  paste into the Supabase SQL editor.

DROP POLICY IF EXISTS "Token holders can read their inspection" ON public.inspections;

REVOKE ALL ON public.inspections FROM anon;

-- The portal route, BB submit and the orchestrator use the service role.
-- 010's grant went with the table 011 dropped and recreated, so restate it.
GRANT ALL ON public.inspections TO service_role;
