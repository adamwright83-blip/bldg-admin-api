#!/usr/bin/env bash
# Per-boot startup: bring the MySQL server back up. The data directory and
# applied schema persist on disk (captured in the environment snapshot), so no
# migrations are re-run here.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bash "$REPO_ROOT/.cursor/mysql-up.sh"
