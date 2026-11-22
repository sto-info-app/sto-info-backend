SET search_path TO "sto_info_app";

-- Nothing to seed, and the empty file is deliberate rather than an oversight.
--
-- The harness seeds after the migrations have run, which is the wrong side
-- of a migration whose whole job is to change rows that were already there.
-- Everything this suite works on is loaded by
-- `declared-content-types-pre-up.sql` instead.
--
-- The file exists because the harness requires one per suite, and an empty
-- file that says why is better than a missing file somebody has to go and
-- work out the absence of.
