#!/usr/bin/env bash
# One-time (per-build) setup for the laundry-butler Cloud Agent environment.
# Installs the MySQL server, JS dependencies, the local .env file, and applies
# the database schema. Idempotent so it is safe to re-run.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# 1. System dependency: MySQL 8 server + client.
if ! command -v mysqld >/dev/null 2>&1; then
  sudo DEBIAN_FRONTEND=noninteractive apt-get update -y
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y mysql-server
fi

# 2. Start MySQL and ensure the app database + user exist.
bash "$REPO_ROOT/.cursor/mysql-up.sh"

# 3. Local development env file (gitignored) from the committed template.
if [ ! -f "$REPO_ROOT/.env" ]; then
  cp "$REPO_ROOT/.cursor/dev.env.example" "$REPO_ROOT/.env"
  echo "Created .env from .cursor/dev.env.example"
fi

# 4. JavaScript dependencies (pinned via pnpm-lock.yaml).
corepack enable >/dev/null 2>&1 || true
pnpm install --frozen-lockfile

# 5. Database schema. Release migrations are not individually idempotent, so
#    only apply them when the schema has not been created yet. The production
#    bootstrap (scripts/migrate.mjs) is idempotent and always runs afterwards.
set -a
# shellcheck disable=SC1091
. "$REPO_ROOT/.env"
set +a

ORDERS_TABLE_COUNT="$(mysql -N -ubutler -pbutler -h127.0.0.1 laundry_butler \
  -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='laundry_butler' AND table_name='orders';" 2>/dev/null || echo 0)"

if [ "${ORDERS_TABLE_COUNT}" = "0" ]; then
  echo "Applying DayForge release migrations..."
  pnpm db:dayforge:release
fi

echo "Running production bootstrap migrations..."
node scripts/migrate.mjs

echo "Install complete."
