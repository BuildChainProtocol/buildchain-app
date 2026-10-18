-- Migration 017: bring the live inspections table up to the inspector-portal schema
--
-- Production never ran 011, which drops and recreates inspections with the
-- token-based portal schema. Its inspections table is still 010's: it has
-- inspection_date / outcome and no token, status, scheduled_date, submitted_at
-- or created_by. Everything written since 011 reads those columns: the
-- orchestrator's dual-condition check (inspections.status), the inspector
-- portal (/inspect/<token>), Assign Inspection and BB inspection anchoring.
-- So on production the inspector condition could never be met.
--
-- Additive and idempotent. It adds 011's columns where missing, keeps 010's
-- columns and rows, carries each 010 result into status, and relaxes
-- inspection_date's NOT NULL (011-style inserts don't set it). On a database
-- built from the migrations (011 ran) it changes nothing.
-- Run once via: supabase db push  OR  paste into the Supabase SQL editor.

ALTER TABLE public.inspections
  ADD COLUMN IF NOT EXISTS token          uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS status         text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS scheduled_date date,
  ADD COLUMN IF NOT EXISTS submitted_at   timestamptz,
  ADD COLUMN IF NOT EXISTS created_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

DO $$
BEGIN
  -- 011's unique token and status check, unless already there
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.inspections'::regclass AND conname = 'inspections_token_key') THEN
    ALTER TABLE public.inspections ADD CONSTRAINT inspections_token_key UNIQUE (token);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.inspections'::regclass AND conname = 'inspections_status_check') THEN
    ALTER TABLE public.inspections ADD CONSTRAINT inspections_status_check
      CHECK (status IN ('pending', 'passed', 'failed', 'cancelled'));
  END IF;

  -- Only on a 010-shaped table (011 has no inspection_date / outcome)
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'inspections'
               AND column_name = 'inspection_date') THEN
    ALTER TABLE public.inspections ALTER COLUMN inspection_date DROP NOT NULL;

    -- Carry each existing 010 result into the portal status
    UPDATE public.inspections
       SET status = CASE outcome
                      WHEN 'pass' THEN 'passed'
                      WHEN 'pass_with_observations' THEN 'passed'
                      WHEN 'fail' THEN 'failed'
                      ELSE 'pending'
                    END,
           submitted_at = COALESCE(submitted_at,
                            CASE WHEN outcome IN ('pass', 'pass_with_observations', 'fail')
                                 THEN inspection_date::timestamptz END)
     WHERE status = 'pending' AND outcome IS DISTINCT FROM 'pending';
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS inspections_draw_idx    ON public.inspections (draw_request_id);
CREATE INDEX IF NOT EXISTS inspections_project_idx ON public.inspections (project_id);
CREATE INDEX IF NOT EXISTS inspections_token_idx   ON public.inspections (token);

-- 011's grant. 010 gave authenticated only SELECT, so an admin's Assign
-- Inspection (insert) and portal submit (update) were refused with 42501.
-- Row-level security still limits writes to admins ("Admins can manage
-- inspections" / "Admins full access on inspections").
GRANT SELECT, INSERT, UPDATE ON public.inspections TO authenticated;
