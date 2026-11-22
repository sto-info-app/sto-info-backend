#!/usr/bin/env bash
#
# Proves the ten-Community limit the only way it can be proved.
#
# ADR-0022 says the limit is a trigger rather than a service check because a
# count is a read-then-write and two concurrent creates both pass one. A single
# session inserting an eleventh row only shows that the trigger runs. What has
# to be shown is that many sessions arriving at once cannot push an owner past
# ten between them, which is what the advisory lock inside the trigger is for.
#
# Each writer opens a transaction, sleeps so they all arrive together, inserts
# a Community for the same owner, and commits. With the lock, they queue and
# exactly one gets the tenth place. Without it, they all count nine and all
# succeed — which is the failure this exists to catch.
#
set -euo pipefail

CONTAINER="${1:?container name required}"
WRITERS="${REHEARSAL_WRITERS:-10}"

sql() {
  docker exec -i -e PGPASSWORD=rehearsal "${CONTAINER}" \
    psql -qtA -U postgres -d rehearsal -c "$1"
}

# Arrange: an owner of their own, untouched by the assertion suite, holding
# nine live Communities. One place left, and ten writers about to want it.
sql "
SET search_path TO \"sto_info_app\";
INSERT INTO \"user\" (\"id\") VALUES ('00000000-0000-0000-0000-0000000face1');
INSERT INTO \"fleet_community\" (\"id\",\"ownerUserId\",\"name\",\"slug\")
SELECT ('00000000-0000-0000-0000-0000000fa' || to_char(number, 'FM000'))::uuid,
       '00000000-0000-0000-0000-0000000face1',
       'Racer ' || number,
       'racer-' || number
  FROM generate_series(1, 9) AS number;
" >/dev/null

race() {
  local label="$1" i

  for ((i = 1; i <= WRITERS; i++)); do
    docker exec -i -e PGPASSWORD=rehearsal "${CONTAINER}" \
      psql -qtA -U postgres -d rehearsal -c "
        SET search_path TO \"sto_info_app\";
        BEGIN;
        SELECT pg_sleep(0.4);
        INSERT INTO \"fleet_community\" (\"ownerUserId\",\"name\",\"slug\")
        VALUES ('00000000-0000-0000-0000-0000000face1','Contender ${i}','contender-${i}');
        COMMIT;" >/dev/null 2>&1 &
  done
  wait

  echo "${label}: ${WRITERS} concurrent writers"
}

expect_count() {
  local label="$1" want="$2" got

  got="$(sql "SET search_path TO \"sto_info_app\";
    SELECT count(*) FROM \"fleet_community\"
     WHERE \"ownerUserId\" = '00000000-0000-0000-0000-0000000face1'
       AND \"deletedAt\" IS NULL")"

  if [ "${got}" != "${want}" ]; then
    echo "FAIL ${label}: ${got} live Communities, expected ${want}" >&2
    exit 1
  fi
  echo "PASS ${label}: the owner holds exactly ${want}"
}

race 'ten writers contend for the tenth place'
expect_count 'the limit held under concurrency' 10
