#!/usr/bin/env bash
#
# Proves that one stored object cannot end up with two asset records, under
# concurrent writes.
#
# The rule matters more than it looks. Two rows for one object means two
# verdicts and two audiences for one set of bytes, and the delivery endpoint
# would serve whichever it happened to find — so a second row in a permissive
# audience is a way past the first row's refusal. One session cannot show the
# rule holds: inserting twice in a row only shows the index exists. Two upload
# handlers registering the same object at the same moment is the case that
# would leave the contradiction behind if this were a service check.
#
# Each writer opens a transaction, sleeps so they all arrive together, inserts,
# and commits. The partial unique index makes the losers block and then fail.
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

# The audience is chosen at random per writer, so the survivor is whichever
# arrived first rather than whichever the test preferred. That is the point: if
# the index were missing, the permissive row could be the one left behind.
race 'one asset per stored object' \
  "INSERT INTO \"file_asset\" (\"kind\",\"state\",\"audience\",\"storage\",\"objectKey\")
   VALUES ('PROFILE_IMAGE','QUARANTINED',
           (('{PUBLIC,OWNER,RESTRICTED}'::text[])[1 + (random() * 2)::int])::\"file_asset_audience_enum\",
           'QUARANTINE','local/assets/contested');"
expect_one 'one asset per stored object' \
  "SELECT count(*) FROM \"file_asset\"
    WHERE \"storage\"='QUARANTINE' AND \"objectKey\"='local/assets/contested' AND \"deletedAt\" IS NULL"
