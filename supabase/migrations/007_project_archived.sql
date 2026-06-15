-- ============================================================
-- Migration 007 — Soft-delete / archive for projects
--
-- Adds archived_at timestamp. Admins can "archive" projects
-- (removes from active list) without permanently deleting them
-- and their associated draw_requests + documents.
-- ============================================================

ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_projects_archived_at ON projects (archived_at)
  WHERE archived_at IS NULL;

COMMENT ON COLUMN projects.archived_at IS
  'Set by admin to archive a project. NULL = active. Set = archived.';
