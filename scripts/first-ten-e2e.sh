#!/usr/bin/env bash
#
# JOYSTICK's first ten minutes, end to end, against a throwaway local MySQL:
#   1. the Google / Slack stand-in (e2e/first-ten-minutes/fakeProviders.mjs) on 127.0.0.1:4999
#   2. the real API and page (development mode, Vite) on 127.0.0.1:3300, flag on
#   3. Playwright (playwright.first-ten-minutes.config.ts)
#
# The database must already be migrated: DATABASE_URL=… node scripts/migrate.mjs
# Every secret here is a placeholder for a disposable database; none of them unlocks anything.
set -euo pipefail

if [ "${NODE_ENV:-}" = "production" ]; then
  echo "first-ten-e2e: refusing to run with NODE_ENV=production" >&2
  exit 1
fi

E2E_DATABASE_URL="${DATABASE_URL:-mysql://root:root@127.0.0.1:3411/first_ten_test}"
case "$E2E_DATABASE_URL" in
  *127.0.0.1*|*localhost*) ;;
  *) echo "first-ten-e2e: the database must be local" >&2; exit 1 ;;
esac

export PORT="${FIRST_TEN_E2E_PORT:-3300}"
export E2E_DATABASE_URL
LOG_DIR="${FIRST_TEN_E2E_LOGS:-tmp/first-ten-e2e-logs}"
mkdir -p "$LOG_DIR"

export FAKE_PROVIDERS_PORT=4999
# Each child gets its own process group, so stopping it stops everything it started (pnpm does not forward signals).
setsid node e2e/first-ten-minutes/fakeProviders.mjs > "$LOG_DIR/fake-providers.log" 2>&1 &
FAKE_PID=$!

setsid bash -c '
  export NODE_ENV=development
  export DATABASE_URL="$E2E_DATABASE_URL"
  export JWT_SECRET=first-ten-e2e-jwt-secret-000000000000000000
  export APP_SHARED_API_SECRET=first-ten-e2e-app-secret-0000000000000000
  export STRIPE_SECRET_KEY=first-ten-e2e-placeholder-not-used
  export JOYSTICK_FIRST_TEN_MINUTES=on
  export JOYSTICK_GOOGLE_CLIENT_ID=fake-google-client
  export JOYSTICK_GOOGLE_CLIENT_SECRET=fake-google-secret
  export JOYSTICK_SLACK_CLIENT_ID=fake-slack-client
  export JOYSTICK_SLACK_CLIENT_SECRET=fake-slack-secret
  export JOYSTICK_FIRST_TEN_PROVIDER_ORIGIN="http://127.0.0.1:${FAKE_PROVIDERS_PORT}"
  exec pnpm exec tsx server/_core/index.ts
' > "$LOG_DIR/server.log" 2>&1 &
SERVER_PID=$!

cleanup() {
  for pid in "$SERVER_PID" "$FAKE_PID"; do kill -TERM -- "-$pid" 2>/dev/null || true; done
  sleep 2
  for pid in "$SERVER_PID" "$FAKE_PID"; do kill -KILL -- "-$pid" 2>/dev/null || true; done
}
trap cleanup EXIT

for _ in $(seq 1 120); do
  if grep -q "Server running on http://localhost:${PORT}/" "$LOG_DIR/server.log"; then break; fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "first-ten-e2e: the server exited before listening" >&2
    cat "$LOG_DIR/server.log" >&2
    exit 1
  fi
  sleep 1
done
grep -q "Server running on http://localhost:${PORT}/" "$LOG_DIR/server.log" || { cat "$LOG_DIR/server.log" >&2; exit 1; }

FIRST_TEN_E2E_BASE_URL="http://127.0.0.1:${PORT}" pnpm exec playwright test --config playwright.first-ten-minutes.config.ts "$@"
