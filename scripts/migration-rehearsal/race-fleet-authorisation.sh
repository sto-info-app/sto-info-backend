#!/usr/bin/env bash
#
# Proves that a delegation cannot be granted and denied at the same time, under
# concurrent writes.
#
# "DENY wins" is only a rule the resolver can apply if the database never holds
# both an open GRANT and an open DENY for the same subject and capability. One
# session cannot demonstrate that: inserting twice in a row only shows the index
# exists. Two administrators deciding opposite things about the same Officer at
# the same moment is the case that matters, and it is the one that would leave a
# contradiction behind if the invariant were a service check.
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

# Arrange: a Community, a Fleet and an Officer untouched by the assertion
# suite, which deletes the Community it used.
sql "
SET search_path TO \"sto_info_app\";
INSERT INTO \"user\" (\"id\") VALUES ('00000000-0000-0000-0000-00000000ca01');
INSERT INTO \"fleet_community\" (\"id\",\"ownerUserId\",\"name\",\"slug\")
VALUES ('00000000-0000-0000-0000-0000000dd001','00000000-0000-0000-0000-00000000ca01','Race Community','race-community');
INSERT INTO \"sto_fleet\" (\"id\",\"communityId\",\"platformId\",\"exactGameName\",\"exactGameNameNormalized\",\"slug\")
VALUES ('00000000-0000-0000-0000-0000000ee001','00000000-0000-0000-0000-0000000dd001','00000000-0000-0000-0000-0000000000b1','Race Fleet','race fleet','race-fleet');
" >/dev/null

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

# Half the writers grant and half deny, chosen at random, so the winner is
# whichever arrived first rather than whichever the test preferred.
race 'one open delegation per role, capability and Fleet' \
  "INSERT INTO \"scope_capability_grant\" (\"communityId\",\"fleetId\",\"subjectRole\",\"capability\",\"effect\")
   VALUES ('00000000-0000-0000-0000-0000000dd001','00000000-0000-0000-0000-0000000ee001','OFFICER','roster.import',
           (('{GRANT,DENY}'::text[])[1 + (random() * 1)::int])::\"scope_capability_effect_enum\");"
expect_one 'one open delegation per role, capability and Fleet' \
  "SELECT count(*) FROM \"scope_capability_grant\"
    WHERE \"fleetId\"='00000000-0000-0000-0000-0000000ee001' AND \"subjectRole\"='OFFICER'
      AND \"capability\"='roster.import' AND \"validTo\" IS NULL AND \"deletedAt\" IS NULL"

race 'one open delegation per person, capability and Fleet' \
  "INSERT INTO \"scope_capability_grant\" (\"communityId\",\"fleetId\",\"subjectUserId\",\"capability\",\"effect\")
   VALUES ('00000000-0000-0000-0000-0000000dd001','00000000-0000-0000-0000-0000000ee001',
           '00000000-0000-0000-0000-00000000ca01','chat.transcript.export','GRANT');"
expect_one 'one open delegation per person, capability and Fleet' \
  "SELECT count(*) FROM \"scope_capability_grant\"
    WHERE \"fleetId\"='00000000-0000-0000-0000-0000000ee001'
      AND \"subjectUserId\"='00000000-0000-0000-0000-00000000ca01'
      AND \"capability\"='chat.transcript.export' AND \"validTo\" IS NULL AND \"deletedAt\" IS NULL"
