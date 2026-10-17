-- Migration 015: link inspections to Building Block's signed inspection results
--
-- BB sends the project's latest signed inspection with each draw (§3.1 of the
-- BB↔BC spec). A passed one anchors that draw's Inspector Credential NFT; this
-- column lets BuildChain refuse to anchor the same BB inspection for a second
-- active draw (one inspection, one draw).
-- Run once via: supabase db push  OR  paste into the Supabase SQL editor.
-- Nullable, so existing rows and inspector-portal inspections keep working.

ALTER TABLE public.inspections
  ADD COLUMN IF NOT EXISTS bb_inspection_result_id bigint;

CREATE INDEX IF NOT EXISTS inspections_bb_inspection_result_id_idx
  ON public.inspections (bb_inspection_result_id)
  WHERE bb_inspection_result_id IS NOT NULL;
