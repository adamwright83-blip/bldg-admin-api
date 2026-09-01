#!/usr/bin/env bash
#
# Serves the built application against the disposable proof database used to
# browser-prove the Goldline living world (flows A-J).
#
# Everything here is fixture configuration for a throwaway MySQL container.
# The passwords match the values the existing Playwright suites already use,
# and the secrets are obvious placeholders — none of them unlock anything.
#
# See scripts/goldline-living-world-proof-seed.ts for the world it serves, and
# server/_core/proofMode.ts for what GOLDLINE_PROOF_MODE does and does not do.
set -euo pipefail

# This script only ever targets a local throwaway database. Refuse anything
# that looks like it is being pointed at a real deployment.
if [ "${NODE_ENV:-}" = "production" ]; then
  echo "goldline-proof-server: refusing to run with NODE_ENV=production" >&2
  exit 1
fi

PROOF_DATABASE_URL="mysql://root:root@127.0.0.1:3399/goldline_proof"
case "$PROOF_DATABASE_URL" in
  *127.0.0.1*|*localhost*) ;;
  *) echo "goldline-proof-server: proof database must be local" >&2; exit 1 ;;
esac

export NODE_ENV=ci
export PORT=4177
export DATABASE_URL="$PROOF_DATABASE_URL"
export DAYFORGE_RELEASE_DB=1
export APP_SHARED_API_SECRET=goldline-proof-app-secret-000000000000000000
export JWT_SECRET=goldline-proof-jwt-secret-000000000000000000
export STRIPE_SECRET_KEY=goldline-proof-placeholder-not-used
# Deterministic stand-ins for the LLM and image providers, so the journal ->
# discovery -> forge chain is provable without live credentials. Refused
# outright when NODE_ENV is production (see server/_core/proofMode.ts).
export GOLDLINE_PROOF_MODE=1
export DRIVER_PASSWORD=pixel-driver-pass
export DRIVER_OPEN_ID=goldline-proof-driver
export ADMIN_PASSWORD=goldline-proof-admin-pass

exec node dist/index.js
