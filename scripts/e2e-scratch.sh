#!/usr/bin/env bash
# Run ONE ad-hoc dynamic spec against a fresh, fully ephemeral test database.
#
# Each invocation is a throwaway `docker compose run --rm` container: the e2e binary
# is built with the `e2e` feature, so it uses `mma_test.db` in the container's app-data
# dir -- which is NOT a mounted volume, so it is destroyed with the container. Every run
# therefore starts from an empty DB. SV is mocked by default (deterministic, no network).
#
# Usage:
#   scripts/e2e-scratch.sh                          # runs test/e2e/scratch.test.ts, mocked SV
#   scripts/e2e-scratch.sh test/e2e/foo.test.ts     # runs a different spec, still ephemeral+mocked
#   scripts/e2e-scratch.sh --real                   # scratch.test.ts against REAL Street View
#   scripts/e2e-scratch.sh --real test/e2e/foo.test.ts
#
# `test/` is live-mounted, so editing the spec needs no rebuild. Rebuild only after app
# (Rust/frontend) changes: scripts/e2e-build.sh. Read results in app/test/logs/<newest>.txt.
set -uo pipefail
cd "$(dirname "$0")/.."

MOCK="--mock"
if [ "${1:-}" = "--real" ]; then
	MOCK=""
	shift
fi

SPEC="${1:-test/e2e/scratch.test.ts}"

exec bash scripts/e2e.sh $MOCK "$SPEC"
