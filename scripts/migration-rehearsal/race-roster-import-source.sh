#!/usr/bin/env bash
#
# Proves that one quarantined object cannot end up with two import records,
# under concurrent writes.
#
# The rule matters because the provenance row is the only surviving evidence of
# what was uploaded — ADR-0001 discards the file itself. Two rows for one asset
# would mean two answers to "which export produced these bytes", with nothing
# to say which is the real one, and an investigator reading either would have
# no way to tell they were reading half the story.
#
# One session cannot show the rule holds: inserting twice in a row only shows
# the constraint exists. Two upload handlers finishing at the same instant is
# the case that would leave the contradiction behind if this were a service
# check, and it is the case a retried request produces in practice.
#
# Each writer opens a transaction, sleeps so they all arrive together, inserts,
# and commits. The unique constraint makes the losers block and then fail.
#
set -euo pipefail

CONTAINER="${1:?container name required}"
WRITERS="${REHEARSAL_WRITERS:-10}"

sql() {
  docker exec -i -e PGPASSWORD=rehearsal "${CONTAINER}" \
    psql -qtA -U postgres -d rehearsal -c "$1"
}

race() {
  local label="$1" statement="$2"
  local i

  for ((i = 1; i <= WRITERS; i++)); do
    docker exec -i -e PGPASSWORD=rehearsal "${CONTAINER}" \
      psql -qtA -U postgres -d rehearsal -c "
        SET search_path TO \"sto_info_app\";
        BEGIN;
        SELECT pg_sleep(0.4);
        ${statement}
        COMMIT;" >/dev/null 2>&1 &
  done
  wait

  echo "${label}: ${WRITERS} concurrent writers"
}

expect_one() {
  local label="$1" query="$2" winners

  winners="$(sql "SET search_path TO \"sto_info_app\"; ${query}")"
  if [ "${winners}" != '1' ]; then
    echo "FAIL ${label}: ${winners} rows survived, expected exactly 1" >&2
    exit 1
  fi
  echo "PASS ${label}: exactly one writer committed"
}

# Each writer claims a different row count and a different source hash, so the
# survivor is whichever arrived first rather than whichever the test preferred.
# If the constraint were missing, the record left behind would describe an
# upload that never happened.
race 'one import record per quarantined object' \
  "INSERT INTO \"fleet_roster_import_source\"
     (\"assetId\",\"fleetId\",\"originalFilename\",\"sourceSha256\",\"sanitisedSha256\",
      \"sourceByteSize\",\"sanitisedByteSize\",\"sourceHeaderShape\",\"rowCount\",\"officerTailRowCount\",\"parserVersion\")
   VALUES ('00000000-0000-0000-0000-0000000aa003','00000000-0000-0000-0000-0000000ea001',
           'Contested.Csv',
           lpad(to_hex((random() * 2147483647)::int), 64, '0'),
           lpad(to_hex((random() * 2147483647)::int), 64, '0'),
           1024, 512, 'OFFICER', (1 + random() * 90)::int, 0, 1);"
expect_one 'one import record per quarantined object' \
  "SELECT count(*) FROM \"fleet_roster_import_source\"
    WHERE \"assetId\" = '00000000-0000-0000-0000-0000000aa003'"
