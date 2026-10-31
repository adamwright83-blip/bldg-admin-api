#!/usr/bin/env bash
# Onboarding intelligence cold tests against production (docs/goldline/ONBOARDING_INTELLIGENCE.md, "Cold tests
# against a real account"). From a Railway-linked checkout:
#
#   pnpm intel:cold --journey <own journey id> --i-have-authorization [options]
#   pnpm intel:cold --sweep [--yes]
#
# Production's settings come from the bldg-admin-api service. Its own DATABASE_URL is private to Railway's network,
# so the database is reached at the MySQL service's public address instead. Nothing secret is printed.
set -euo pipefail
cd "$(dirname "$0")/.."

public_url="$(railway variable list --service MySQL --json | node -e '
let text = "";
process.stdin.on("data", chunk => (text += chunk)).on("end", () => {
  const vars = JSON.parse(text);
  const row = Array.isArray(vars) ? vars.find(item => item && (item.name ?? item.key) === "MYSQL_PUBLIC_URL") : null;
  process.stdout.write((Array.isArray(vars) ? row?.value : vars.MYSQL_PUBLIC_URL) ?? "");
});')"
if [ -z "$public_url" ]; then
  echo "Couldn't read the MySQL service's public address. Is this checkout linked (railway link) to the production project?" >&2
  exit 2
fi

exec railway run --service bldg-admin-api -- env DATABASE_URL="$public_url" npx tsx scripts/onboarding-intelligence-real-account.ts "$@"
