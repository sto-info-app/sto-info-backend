#!/usr/bin/env bash
#
# Proves FC-004's second acceptance criterion the way it is worded.
#
# "One current personal membership per Character and one current Armada
# membership per Fleet **under concurrent writes**" is not shown by inserting
# twice in one session — that only proves the index exists. It is shown by many
# sessions attempting the same insert at once and exactly one of them winning.
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

# Arrange: a Character and an Armada untouched by the assertion suite, plus
# three Fleets in one Community to contend for its single Alpha slot.
sql "
SET search_path TO \"sto_info_app\";
INSERT INTO \"character\" (\"id\") VALUES ('00000000-0000-0000-0000-00000000cc01');
INSERT INTO \"sto_armada\" (\"id\",\"communityId\",\"platformId\",\"exactGameName\",\"exactGameNameNormalized\",\"slug\")
VALUES ('00000000-0000-0000-0000-0000000aa001','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000b1','Race Armada','race armada','race-armada');
INSERT INTO \"sto_fleet\" (\"id\",\"communityId\",\"platformId\",\"exactGameName\",\"exactGameNameNormalized\",\"slug\") VALUES
 ('00000000-0000-0000-0000-000000000ea1','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000b1','Race A','race a','race-a'),
 ('00000000-0000-0000-0000-000000000ea2','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000b1','Race B','race b','race-b'),
 ('00000000-0000-0000-0000-000000000ea3','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000b1','Race C','race c','race-c');
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

race 'one open membership per Character' \
  "INSERT INTO \"character_fleet_membership\" (\"characterId\",\"fleetId\",\"validFrom\")
   VALUES ('00000000-0000-0000-0000-00000000cc01','00000000-0000-0000-0000-000000000ea1', now());"
expect_one 'one open membership per Character' \
  "SELECT count(*) FROM \"character_fleet_membership\"
    WHERE \"characterId\"='00000000-0000-0000-0000-00000000cc01' AND \"validTo\" IS NULL"

# Different Fleets on purpose: the losers must fail on the Alpha slot, not on
# the one-open-association-per-Fleet index.
race 'one open Alpha per Armada' \
  "INSERT INTO \"armada_fleet_membership\" (\"communityId\",\"armadaId\",\"fleetId\",\"position\",\"validFrom\")
   VALUES ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000aa001',
           ('{00000000-0000-0000-0000-000000000ea1,00000000-0000-0000-0000-000000000ea2,00000000-0000-0000-0000-000000000ea3}'::uuid[])[1 + (random() * 2)::int],
           'ALPHA', now());"
expect_one 'one open Alpha per Armada' \
  "SELECT count(*) FROM \"armada_fleet_membership\"
    WHERE \"armadaId\"='00000000-0000-0000-0000-0000000aa001' AND \"position\"='ALPHA' AND \"validTo\" IS NULL"
