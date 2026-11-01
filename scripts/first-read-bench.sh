#!/usr/bin/env bash
# The first-reading benchmark against production (scripts/first-read-bench.ts). Read-only. From a Railway-linked
# checkout:
#
#   scripts/first-read-bench.sh --journey <own journey id> --i-have-authorization [--strategies fast,agent,survey]
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

# The address travels in the environment, never on a command line, where any process on this machine could read it
# with ps. Railway injects the service's own (private) DATABASE_URL, so it is set inside, from a name Railway leaves alone.
export FIRST_READ_DATABASE_URL="$public_url"
exec railway run --service bldg-admin-api -- sh -c 'DATABASE_URL="$FIRST_READ_DATABASE_URL" exec npx tsx scripts/first-read-bench.ts "$@"' first-read-bench "$@"
