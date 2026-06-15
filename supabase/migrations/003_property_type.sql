-- Fix property_type check constraint to match application form values.
-- The form sends: single_family, multi_family, commercial, mixed_use, land, industrial
-- The original constraint only accepted: residential, multifamily, commercial, adu, other
-- This caused every "Create Project" submit to fail with a DB constraint violation.

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_property_type_check;

ALTER TABLE projects ADD CONSTRAINT projects_property_type_check
  CHECK (property_type IN (
    'single_family',
    'multi_family',
    'commercial',
    'mixed_use',
    'land',
    'industrial',
    'adu',
    'other'
  ));
