#!/usr/bin/env bash
# Serves the built app against the disposable proof database used for browser
# proof of the living world. Never point this at production.
set -euo pipefail
export NODE_ENV=ci
export PORT=4177
export DATABASE_URL="mysql://root:root@127.0.0.1:3399/goldline_proof"
export DAYFORGE_RELEASE_DB=1
export APP_SHARED_API_SECRET=goldline-proof-app-secret-000000000000000000
export JWT_SECRET=goldline-proof-jwt-secret-000000000000000000
export STRIPE_SECRET_KEY=goldline-proof-placeholder-not-used
export DRIVER_PASSWORD=pixel-driver-pass
export DRIVER_OPEN_ID=goldline-proof-driver
export ADMIN_PASSWORD=goldline-proof-admin-pass
exec node dist/index.js
