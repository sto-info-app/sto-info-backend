#!/usr/bin/env bash
#
# Rehearses a migration against a real, throwaway PostgreSQL instance.
#
# Everything the unit specs can prove about a migration is a property of its
# SQL text. Whether PostgreSQL actually accepts that SQL, and whether the
# constraints in it reject what they are supposed to reject, is a different
# question — and it is the one that matters on deploy day. This script answers
# it by starting a container, replaying the migration into it, and then
# deliberately trying to break every rule the migration claims to enforce.
#
# It never touches a real database. It talks only to the container it started,
# over `docker exec`, and it reads no database environment variable — so it
# cannot be pointed at a developer or hosted database by a stray .env. The
# container is removed on exit, including on failure or interrupt.
#
# Usage:
#   bash scripts/migration-rehearsal/run-rehearsal.sh <migration.ts>[,<migration.ts>...] <name>
#
# <name> selects sql/<name>-seed.sql and sql/<name>-assert.sql, and
# sql/../race-<name>.sh, sql/<name>-pre-up.sql and sql/<name>-post-down.sql
# when they exist.
#
# The two optional files exist for a migration that moves existing data rather
# than only adding to the schema. A pre-up file loads rows into the stub tables
# before the migration runs, so there is something for it to move; a post-down
# file runs after the rollback and before the table count, which is the only
# place a claim that the rollback put the data back can be tested.
#
# A migration that builds on an earlier one is given the whole chain, comma
# separated and in application order. The ups are applied in that order and the
# downs in the reverse, so the rollback check still ends at the bare stubs.
#
set -euo pipefail

MIGRATIONS="${1:-src/database/migrations/1791600000000-CreateFleetCommunityDomainTables.ts}"
SUITE="${2:-fleet-community}"

IFS=',' read -r -a MIGRATION_LIST <<<"${MIGRATIONS}"

PG_IMAGE="${REHEARSAL_PG_IMAGE:-postgres:17-alpine}"
CONTAINER="migration-rehearsal-$$"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${HERE}/../.." && pwd)"
WORK="$(mktemp -d)"

SEED="${HERE}/sql/${SUITE}-seed.sql"
ASSERT="${HERE}/sql/${SUITE}-assert.sql"
PRE_UP="${HERE}/sql/${SUITE}-pre-up.sql"
POST_DOWN="${HERE}/sql/${SUITE}-post-down.sql"

cleanup() {
  docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
  rm -rf "${WORK}"
}
trap cleanup EXIT INT TERM

step() { printf '\n=== %s ===\n' "$1"; }

# Runs a SQL file inside the container, aborting the rehearsal on any error.
psql_file() {
  docker exec -i -e PGPASSWORD=rehearsal "${CONTAINER}" \
    psql -v ON_ERROR_STOP=1 -U postgres -d rehearsal -q <"$1"
}

# Runs a single statement and prints only its result.
psql_value() {
  docker exec -i -e PGPASSWORD=rehearsal "${CONTAINER}" \
    psql -qtA -U postgres -d rehearsal -c "$1"
}

for file in "${MIGRATION_LIST[@]}" "${SEED}" "${ASSERT}"; do
  if [ ! -f "${REPO}/${file}" ] && [ ! -f "${file}" ]; then
    echo "Not found: ${file}" >&2
    exit 1
  fi
done

if ! docker version >/dev/null 2>&1; then
  echo 'Docker is not available; this rehearsal needs it.' >&2
  exit 1
fi

cd "${REPO}"
for index in "${!MIGRATION_LIST[@]}"; do
  step "Emitting SQL from ${MIGRATION_LIST[${index}]}"
  npx ts-node -r tsconfig-paths/register \
    "${HERE}/emit-migration-sql.ts" "${MIGRATION_LIST[${index}]}" \
    "${WORK}/up.${index}.sql" "${WORK}/down.${index}.sql"
done

step "Starting ${PG_IMAGE}"
docker run -d --name "${CONTAINER}" \
  -e POSTGRES_PASSWORD=rehearsal -e POSTGRES_DB=rehearsal \
  "${PG_IMAGE}" >/dev/null
ready=0
until [ "${ready}" -ge 3 ]; do
  if docker exec "${CONTAINER}" psql -U postgres -d rehearsal -c 'SELECT 1' >/dev/null 2>&1; then
    ready=$((ready + 1))
  else
    ready=0
  fi
  sleep 1
done

# The migration references tables other migrations created. Stand-ins carrying
# only the columns its foreign keys need are enough, and keep the rehearsal
# independent of every earlier migration.
step 'Applying stub parent tables'
psql_file "${HERE}/sql/stubs.sql"

if [ -f "${PRE_UP}" ]; then
  step 'Loading rows the migration will have to carry across'
  psql_file "${PRE_UP}"
fi

step 'Applying the migrations (up)'
for index in "${!MIGRATION_LIST[@]}"; do
  psql_file "${WORK}/up.${index}.sql"
done

step 'Seeding'
psql_file "${SEED}"

step 'Asserting — every statement below is meant to be rejected'
psql_file "${ASSERT}"

if [ -f "${HERE}/race-${SUITE}.sh" ]; then
  step 'Racing concurrent writers'
  bash "${HERE}/race-${SUITE}.sh" "${CONTAINER}"
fi

# Rolling back an empty schema proves very little. This rolls back over the
# rows the assertions left behind, which is the case that actually goes wrong.
step 'Rolling back (down) with data present'
for ((index = ${#MIGRATION_LIST[@]} - 1; index >= 0; index--)); do
  psql_file "${WORK}/down.${index}.sql"
done

if [ -f "${POST_DOWN}" ]; then
  step 'Asserting what the rollback put back'
  psql_file "${POST_DOWN}"
fi

remaining="$(psql_value "SELECT count(*) FROM information_schema.tables WHERE table_schema='sto_info_app'")"
types="$(psql_value "SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='sto_info_app' AND t.typtype='e'")"
expected_stubs="$(grep -c '^CREATE TABLE' "${HERE}/sql/stubs.sql")"

if [ "${types}" -ne 0 ]; then
  echo "FAIL: ${types} enum type(s) survived the rollback" >&2
  exit 1
fi
if [ "${remaining}" -ne "${expected_stubs}" ]; then
  echo "FAIL: ${remaining} tables left after rollback, expected the ${expected_stubs} stubs" >&2
  exit 1
fi
echo "PASS: rollback left only the ${expected_stubs} stub tables and no enum types"

step 'Re-applying the migrations to the same database'
for index in "${!MIGRATION_LIST[@]}"; do
  psql_file "${WORK}/up.${index}.sql"
done

printf '\nREHEARSAL PASSED: up -> assert -> down (with data) -> up, on %s\n' "${PG_IMAGE}"
