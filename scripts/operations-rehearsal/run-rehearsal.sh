#!/usr/bin/env bash
#
# Rehearses restarts, outages, a restore and a rollback of the file pipeline
# on a throwaway local stack, and records how long each took (FC-042).
#
# The runbooks in docs/operations/ say what to do when the worker stops, a
# dependency goes away, the database is restored from a backup or a release is
# rolled back. This proves they are true of the code as it stands: the real
# backend and the real worker, built from these checkouts, against a real
# PostgreSQL 18, Redis, MinIO standing in for R2, clamd and a local Secrets
# Manager — each in a container this script created and removes on exit,
# including on failure or interrupt.
#
# It touches nothing it did not create. Every container is named
# ops-rehearsal-<pid>-*, on a network of its own, publishing only on
# 127.0.0.1 and only on ports chosen away from a developer's stack (5432,
# 6379, 9100, 3310). No .env file is read: every credential either
# application sees is generated here, stored in the local Secrets Manager and
# never printed. Neither application can reach the internet: both are given a
# proxy that refuses everything, so no call can reach Cloudflare, and the
# rehearsal reports any attempt.
#
# Usage:
#   bash scripts/operations-rehearsal/run-rehearsal.sh [operations|adversarial|load]
#
# The argument chooses what runs on the stack: this rehearsal (the default),
# FC-043's adversarial rehearsal in scripts/adversarial-rehearsal/, or FC-044's
# load rehearsal in scripts/load-rehearsal/. Neither needs an older release,
# so neither builds one.
#
# Environment (all optional):
#   REHEARSAL_WORKER_REPO   the worker checkout. Default: the sibling
#                           ../sto-info-file-scan-worker.
#   REHEARSAL_RESULTS       where the results table is written. Default: a
#                           file in the system temporary directory, named in
#                           the last line of output.
#   REHEARSAL_OLD_REF       the release a rollback goes back to. Default
#                           origin/production. It is exported with git
#                           archive, installed with npm ci and built, which
#                           takes a few minutes.
#   REHEARSAL_SKIP_OLD_BUILD=1
#                           skip that build; the rollback scenario then proves
#                           the database guard and the secret names only.
#   REHEARSAL_PG_IMAGE, REHEARSAL_REDIS_IMAGE, REHEARSAL_MINIO_IMAGE,
#   REHEARSAL_CLAMAV_IMAGE, REHEARSAL_AWS_IMAGE
#                           the images to use; the defaults are listed below.
#   REHEARSAL_PORT_BASE     the first of nine consecutive host ports.
#                           Default 55400.
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${HERE}/../.." && pwd)"

SUITE="${1:-operations}"
case "${SUITE}" in
operations) SCRIPT="${HERE}/rehearse.ts" ;;
adversarial)
  SCRIPT="${REPO}/scripts/adversarial-rehearsal/rehearse.ts"
  REHEARSAL_SKIP_OLD_BUILD=1
  ;;
load)
  SCRIPT="${REPO}/scripts/load-rehearsal/rehearse.ts"
  REHEARSAL_SKIP_OLD_BUILD=1
  ;;
*)
  echo "Unknown rehearsal '${SUITE}'; choose operations, adversarial or load." >&2
  exit 1
  ;;
esac
WORKER_REPO="${REHEARSAL_WORKER_REPO:-${REPO}/../sto-info-file-scan-worker}"

PG_IMAGE="${REHEARSAL_PG_IMAGE:-postgres:18-alpine}"
REDIS_IMAGE="${REHEARSAL_REDIS_IMAGE:-redis:7-alpine}"
MINIO_IMAGE="${REHEARSAL_MINIO_IMAGE:-minio/minio:RELEASE.2025-04-22T22-12-26Z}"
CLAMAV_IMAGE="${REHEARSAL_CLAMAV_IMAGE:-clamav/clamav:stable}"
# LocalStack's community image; later tags need an account token.
AWS_IMAGE="${REHEARSAL_AWS_IMAGE:-localstack/localstack:3.8}"
OLD_REF="${REHEARSAL_OLD_REF:-origin/production}"

PREFIX="ops-rehearsal-$$"
NETWORK="${PREFIX}-net"
CLAMD_IMAGE="${PREFIX}-clamd:local"
WORK="$(mktemp -d)"
PIDS="${WORK}/pids"
touch "${PIDS}"

BASE="${REHEARSAL_PORT_BASE:-55400}"
PG_PORT=$((BASE + 0))
REDIS_PORT=$((BASE + 1))
MINIO_PORT=$((BASE + 2))
CLAMD_PORT=$((BASE + 3))
AWS_PORT=$((BASE + 4))
BACKEND_PORT=$((BASE + 5))
WORKER_PORT=$((BASE + 6))
EGRESS_PORT=$((BASE + 7))

WINDOWS=0
case "$(uname -s)" in
MINGW* | MSYS* | CYGWIN*) WINDOWS=1 ;;
esac

# A path as Node on this machine wants it.
native_path() {
  if [ "${WINDOWS}" -eq 1 ]; then
    cygpath -m "$1"
  else
    printf '%s' "$1"
  fi
}

cleanup() {
  local status=$?
  set +e
  # The TypeScript half stops what it started, but not if it was killed.
  while read -r pid; do
    [ -z "${pid}" ] && continue
    if [ "${WINDOWS}" -eq 1 ]; then
      taskkill //F //T //PID "${pid}" >/dev/null 2>&1
    else
      kill -9 "${pid}" >/dev/null 2>&1
    fi
  done <"${PIDS}"
  for service in pg redis minio clamd aws; do
    docker rm -f -v "${PREFIX}-${service}" >/dev/null 2>&1
  done
  docker network rm "${NETWORK}" >/dev/null 2>&1
  docker image rm -f "${CLAMD_IMAGE}" >/dev/null 2>&1
  rm -rf "${WORK}"
  exit "${status}"
}
trap cleanup EXIT INT TERM

step() { printf '\n=== %s ===\n' "$1"; }

if ! docker version >/dev/null 2>&1; then
  echo 'Docker is not available; this rehearsal needs it.' >&2
  exit 1
fi

if [ ! -f "${WORKER_REPO}/package.json" ] || [ ! -f "${WORKER_REPO}/docker/clamd.conf" ]; then
  echo "No worker checkout at ${WORKER_REPO}; set REHEARSAL_WORKER_REPO." >&2
  exit 1
fi
WORKER_REPO="$(cd "${WORKER_REPO}" && pwd)"

for port in "${PG_PORT}" "${REDIS_PORT}" "${MINIO_PORT}" "${CLAMD_PORT}" \
  "${AWS_PORT}" "${BACKEND_PORT}" "${WORKER_PORT}" "${EGRESS_PORT}"; do
  if node -e "require('net').createConnection(${port}, '127.0.0.1').on('connect', () => process.exit(0)).on('error', () => process.exit(1))"; then
    echo "Port ${port} is in use; set REHEARSAL_PORT_BASE to a free range." >&2
    exit 1
  fi
done

if [ ! -d "${REPO}/node_modules" ] || [ ! -d "${WORKER_REPO}/node_modules" ]; then
  echo 'Run npm ci in both checkouts first.' >&2
  exit 1
fi

RESULTS="${REHEARSAL_RESULTS:-$(dirname "${WORK}")/${SUITE}-rehearsal-$(date -u +%Y%m%dT%H%M%SZ).md}"

# Credentials the containers are created with. Generated, never printed, and
# gone with the containers.
PG_PASSWORD="$(node -e "process.stdout.write(require('crypto').randomBytes(18).toString('hex'))")"
MINIO_PASSWORD="$(node -e "process.stdout.write(require('crypto').randomBytes(18).toString('hex'))")"

# The release a rollback would go back to. Exported rather than checked out,
# so the repository gains no worktree, and installed and built in the
# background while the current code builds.
OLD_MAIN=''
OLD_SKIPPED=''
OLD_BUILD_PID=''
if [ "${REHEARSAL_SKIP_OLD_BUILD:-0}" = '1' ]; then
  OLD_SKIPPED='REHEARSAL_SKIP_OLD_BUILD=1'
elif ! git -C "${REPO}" rev-parse --verify --quiet "${OLD_REF}^{commit}" >/dev/null; then
  OLD_SKIPPED="${OLD_REF} is not a commit in this repository"
else
  step "Exporting ${OLD_REF} ($(git -C "${REPO}" rev-parse --short "${OLD_REF}")) and building it in the background"
  mkdir -p "${WORK}/old-backend"
  git -C "${REPO}" archive --format=tar "${OLD_REF}" | tar -x -C "${WORK}/old-backend"
  (
    cd "${WORK}/old-backend"
    HUSKY=0 npm ci --no-audit --no-fund --loglevel=error &&
      npx tsc -p tsconfig.build.json --incremental false --sourceMap false --declaration false &&
      touch "${WORK}/old-backend.built"
  ) >"${WORK}/old-backend-build.log" 2>&1 &
  OLD_BUILD_PID=$!
fi

# Builds a checkout into this run's directory rather than its own dist/, so
# nothing in the checkout changes and nothing another build does to dist/ can
# pull the code out from under the rehearsal.
build() {
  local checkout="$1" out="$2" config="${WORK}/tsconfig.$2.json"
  cat >"${config}" <<JSON
{
  "extends": "$(native_path "${checkout}")/tsconfig.json",
  "compilerOptions": {
    "outDir": "$(native_path "${WORK}/${out}")",
    "rootDir": "$(native_path "${checkout}")",
    "incremental": false,
    "sourceMap": false,
    "declaration": false,
    "typeRoots": ["$(native_path "${checkout}")/node_modules/@types"]
  },
  "include": ["$(native_path "${checkout}")/src/**/*.ts", "$(native_path "${checkout}")/config/**/*.ts"],
  "exclude": ["$(native_path "${checkout}")/src/**/*.spec.ts", "$(native_path "${checkout}")/src/**/__tests__/**"]
}
JSON
  (cd "${checkout}" && npx tsc -p "$(native_path "${config}")")
}

step "Building the backend ($(git -C "${REPO}" rev-parse --short HEAD) plus working tree)"
build "${REPO}" backend
# What `npm run assets:copy` does for dist/.
mkdir -p "${WORK}/backend/src/views"
cp -r "${REPO}/src/views/email-templates" "${WORK}/backend/src/views/"

step "Building the worker ($(git -C "${WORKER_REPO}" rev-parse --short HEAD) plus working tree)"
build "${WORKER_REPO}" worker

step "Creating containers on ${NETWORK} (started by the rehearsal, so the cold start is timed)"
docker network create "${NETWORK}" >/dev/null

# A signature of the rehearsal's own, so a real detection can go through
# the real pipeline without EICAR: an antivirus on the machine running the
# rehearsal can intercept EICAR in its own localhost traffic, between MinIO
# and the worker, and the scan then never sees it (FC-043). Nothing but the
# rehearsal ever writes this marker.
TEST_SIGNATURE="FC043-ADVERSARIAL-REHEARSAL-MARKER-$(date -u +%Y%m%d)"
TEST_SIGNATURE_HEX="$(printf '%s' "${TEST_SIGNATURE}" | od -An -tx1 | tr -d ' \n')"

# The scanner, configured as deployed except that it listens beyond
# loopback and knows the test signature, baked into an image because Git
# Bash rewrites container-side paths on a command line (see the worker's
# scan rehearsal).
docker build -q -t "${CLAMD_IMAGE}" -f - "${WORKER_REPO}" >/dev/null <<DOCKERFILE
FROM ${CLAMAV_IMAGE}
COPY docker/clamd.conf /etc/clamav/clamd.conf
RUN sed -i 's/^TCPAddr 127\.0\.0\.1\$/TCPAddr 0.0.0.0/' /etc/clamav/clamd.conf \\
 && grep -q '^TCPAddr 0\.0\.0\.0\$' /etc/clamav/clamd.conf \\
 && echo 'FC043.Rehearsal.Marker:0:*:${TEST_SIGNATURE_HEX}' > /var/lib/clamav/fc043-rehearsal.ndb
ENTRYPOINT ["/usr/sbin/clamd", "--config-file=/etc/clamav/clamd.conf"]
DOCKERFILE

docker create --name "${PREFIX}-pg" --network "${NETWORK}" \
  -p "127.0.0.1:${PG_PORT}:5432" \
  -e POSTGRES_PASSWORD="${PG_PASSWORD}" -e POSTGRES_DB=rehearsal \
  "${PG_IMAGE}" >/dev/null
docker create --name "${PREFIX}-redis" --network "${NETWORK}" \
  -p "127.0.0.1:${REDIS_PORT}:6379" "${REDIS_IMAGE}" >/dev/null
# MINIO_DOMAIN because neither application sets forcePathStyle; the backend
# reaches MinIO by IP, which the SDK addresses path-style anyway.
MSYS_NO_PATHCONV=1 docker create --name "${PREFIX}-minio" --network "${NETWORK}" \
  -p "127.0.0.1:${MINIO_PORT}:9000" \
  -e MINIO_ROOT_USER=ops-rehearsal -e MINIO_ROOT_PASSWORD="${MINIO_PASSWORD}" \
  -e MINIO_DOMAIN=localhost \
  "${MINIO_IMAGE}" server /data >/dev/null
docker create --name "${PREFIX}-clamd" --network "${NETWORK}" \
  -p "127.0.0.1:${CLAMD_PORT}:3310" "${CLAMD_IMAGE}" >/dev/null
docker create --name "${PREFIX}-aws" --network "${NETWORK}" \
  -p "127.0.0.1:${AWS_PORT}:4566" \
  -e SERVICES=secretsmanager,ses,sns \
  "${AWS_IMAGE}" >/dev/null

echo 'The scanner will run with:'
docker run --rm --entrypoint sh "${CLAMD_IMAGE}" -c \
  "grep -E '^(TCPAddr|StreamMaxLength|MaxFileSize|MaxScanSize|MaxRecursion|MaxFiles|MaxScanTime|AlertExceedsMax)' /etc/clamav/clamd.conf"

if [ -n "${OLD_BUILD_PID}" ]; then
  step "Waiting for ${OLD_REF} to finish building"
  if wait "${OLD_BUILD_PID}" && [ -f "${WORK}/old-backend.built" ]; then
    OLD_MAIN="$(native_path "${WORK}/old-backend/dist/src/main.js")"
  else
    OLD_SKIPPED="building ${OLD_REF} failed: $(tail -3 "${WORK}/old-backend-build.log" | tr '\n' ' ')"
    echo "${OLD_SKIPPED}" >&2
  fi
fi

step 'Rehearsing'
cd "${REPO}"
REHEARSAL_WORK="$(native_path "${WORK}")" \
  REHEARSAL_REPO="$(native_path "${REPO}")" \
  REHEARSAL_WORKER_REPO="$(native_path "${WORKER_REPO}")" \
  REHEARSAL_PREFIX="${PREFIX}" \
  REHEARSAL_PG_PORT="${PG_PORT}" REHEARSAL_REDIS_PORT="${REDIS_PORT}" \
  REHEARSAL_MINIO_PORT="${MINIO_PORT}" REHEARSAL_CLAMD_PORT="${CLAMD_PORT}" \
  REHEARSAL_AWS_PORT="${AWS_PORT}" REHEARSAL_BACKEND_PORT="${BACKEND_PORT}" \
  REHEARSAL_WORKER_PORT="${WORKER_PORT}" REHEARSAL_EGRESS_PORT="${EGRESS_PORT}" \
  REHEARSAL_PG_PASSWORD="${PG_PASSWORD}" REHEARSAL_MINIO_PASSWORD="${MINIO_PASSWORD}" \
  REHEARSAL_OLD_BACKEND_MAIN="${OLD_MAIN}" REHEARSAL_OLD_REF="${OLD_REF}" \
  REHEARSAL_OLD_SKIPPED="${OLD_SKIPPED}" \
  REHEARSAL_TEST_SIGNATURE="${TEST_SIGNATURE}" \
  REHEARSAL_RESULTS="$(native_path "${RESULTS}")" \
  TS_NODE_PROJECT=tsconfig.scripts.json \
  npx ts-node -r tsconfig-paths/register "${SCRIPT}"

printf '\n%s REHEARSAL COMPLETE. Results: %s\n' "$(printf '%s' "${SUITE}" | tr '[:lower:]' '[:upper:]')" "$(native_path "${RESULTS}")"
