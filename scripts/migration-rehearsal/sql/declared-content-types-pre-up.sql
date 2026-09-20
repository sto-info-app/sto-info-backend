SET search_path TO "sto_info_app";

-- The rows the migration has to reduce, loaded before it runs.
--
-- `file_asset` is created here rather than by its own migration, and that is
-- the same choice `calendar-dates` makes about `account`: this suite
-- rehearses one data migration, and dragging in the four schema migrations
-- that build the real table would rehearse those instead. What matters is
-- that the column has the type and nullability the real one has, so the
-- statements under test behave as they will.
CREATE TABLE "sto_info_app"."file_asset" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "declaredContentType" varchar(255),
  CONSTRAINT "PK_file_asset_stub" PRIMARY KEY ("id")
);

-- Every spelling the two upload paths can produce, and three that no
-- normalisation can rescue. The identifiers group by case — a for JPEG, b
-- for PNG, c for CSV, d for nothing declared, e for claims that are not
-- media types and f for one the table has never heard of — because an
-- assertion that fails should be traceable to a row without counting lines.
INSERT INTO "file_asset" ("id", "declaredContentType") VALUES
  -- The alias the existing image upload path actually stores.
  ('00000000-0000-0000-0000-00000000a001', 'image/jpg'),
  ('00000000-0000-0000-0000-00000000a002', 'IMAGE/JPG'),
  ('00000000-0000-0000-0000-00000000a003', 'image/pjpeg'),
  ('00000000-0000-0000-0000-00000000a004', '  image/jpeg  '),
  ('00000000-0000-0000-0000-00000000b001', 'image/x-png'),
  ('00000000-0000-0000-0000-00000000b002', 'image/png'),
  -- What a Windows browser sends for a .csv, with and without parameters.
  ('00000000-0000-0000-0000-00000000c001', 'application/vnd.ms-excel'),
  ('00000000-0000-0000-0000-00000000c002', 'text/csv; charset=utf-8'),
  ('00000000-0000-0000-0000-00000000c003', 'TEXT/CSV; CHARSET=UTF-8'),
  ('00000000-0000-0000-0000-00000000c004', 'application/csv'),
  ('00000000-0000-0000-0000-00000000c005', 'text/comma-separated-values'),
  -- Nothing said, which is what the legacy estate carries.
  ('00000000-0000-0000-0000-00000000d001', NULL),
  -- Claims that are not media types at all. A browser does not send these;
  -- something else writing to this column one day might.
  ('00000000-0000-0000-0000-00000000e001', 'rubbish'),
  ('00000000-0000-0000-0000-00000000e002', 'image/*'),
  ('00000000-0000-0000-0000-00000000e003', '; charset=utf-8'),
  -- A type the table has never heard of, which must survive unharmed.
  ('00000000-0000-0000-0000-00000000f001', 'Application/Vnd.Made-Up');
