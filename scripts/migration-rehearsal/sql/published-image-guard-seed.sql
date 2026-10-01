SET search_path TO "sto_info_app";

-- One registry picture in each state a guard decision turns on, each with the
-- reference a feature column would hold.
INSERT INTO "file_asset" ("id", "state", "deliveryReference") VALUES
  ('00000000-0000-0000-0000-0000000ab001', 'AVAILABLE', 'published-picture'),
  ('00000000-0000-0000-0000-0000000ab002', 'UNVERIFIED', 'legacy-picture'),
  ('00000000-0000-0000-0000-0000000ab003', 'CLEAN', 'clean-picture'),
  ('00000000-0000-0000-0000-0000000ab004', 'REVOKED', 'revoked-picture'),
  ('00000000-0000-0000-0000-0000000ab005', 'REJECTED', 'rejected-picture'),
  ('00000000-0000-0000-0000-0000000ab006', 'QUARANTINED', 'quarantined-picture'),
  ('00000000-0000-0000-0000-0000000ab007', 'DELETED', 'deleted-picture');
