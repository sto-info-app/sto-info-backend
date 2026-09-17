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
#   bash scripts/migration-rehearsal/run-rehearsal.sh <migration.ts> <name>
#
# <name> selects sql/<name>-seed.sql and sql/<name>-assert.sql.
#
set -euo pipefail

MIGRATION="${1:-src/database/migrations/1791600000000-CreateFleetCommunityDomainTables.ts}"
SUITE="${2:-fleet-community}"

PG_IMAGE="${REHEARSAL_PG_IMAGE:-postgres:17-alpine}"
CONTAINER="migration-rehearsal-$$"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${HERE}/../.." && pwd)"
WORK="$(mktemp -d)"

SEED="${HERE}/sql/${SUITE}-seed.sql"
ASSERT="${HERE}/sql/${SUITE}-assert.sql"

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

for file in "${MIGRATION}" "${SEED}" "${ASSERT}"; do
  if [ ! -f "${REPO}/${file}" ] && [ ! -f "${file}" ]; then
    echo "Not found: ${file}" >&2
    exit 1
  fi
done

if ! docker version >/dev/null 2>&1; then
  echo 'Docker is not available; this rehearsal needs it.' >&2
  exit 1
fi

step "Emitting SQL from ${MIGRATION}"
cd "${REPO}"
npx ts-node -r tsconfig-paths/register \
  "${HERE}/emit-migration-sql.ts" "${MIGRATION}" "${WORK}/up.sql" "${WORK}/down.sql"

step "Starting ${PG_IMAGE}"
docker run -d --name "${CONTAINER}" \
  -e POSTGRES_PASSWORD=rehearsal -e POSTGRES_DB=rehearsal \
  "${PG_IMAGE}" >/dev/null
until docker exec "${CONTAINER}" pg_isready -U postgres >/dev/null 2>&1; do
  sleep 1
done

# The migration references tables other migrations created. Stand-ins carrying
# only the columns its foreign keys need are enough, and keep the rehearsal
# independent of every earlier migration.
step 'Applying stub parent tables'
psql_file "${HERE}/sql/stubs.sql"

step 'Applying the migration (up)'
psql_file "${WORK}/up.sql"

step 'Seeding'
psql_file "${SEED}"

step 'Asserting — every statement below is meant to be rejected'
psql_file "${ASSERT}"

if [ "${SUITE}" = 'fleet-community' ]; then
  step 'Racing concurrent writers'
  bash "${HERE}/race-fleet-community.sh" "${CONTAINER}"
fi

# Rolling back an empty schema proves very little. This rolls back over the
# rows the assertions left behind, which is the case that actually goes wrong.
step 'Rolling back (down) with data present'
psql_file "${WORK}/down.sql"

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

step 'Re-applying the migration to the same database'
psql_file "${WORK}/up.sql"

printf '\nREHEARSAL PASSED: up -> assert -> down (with data) -> up, on %s\n' "${PG_IMAGE}"
