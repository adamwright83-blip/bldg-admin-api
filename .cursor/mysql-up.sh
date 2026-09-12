#!/usr/bin/env bash
# Bring up the local MySQL server and ensure the app database + user exist.
# Idempotent: safe to run repeatedly and on every boot.
set -euo pipefail

sudo service mysql start || true

for _ in $(seq 1 30); do
  if sudo mysqladmin ping >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! sudo mysqladmin ping >/dev/null 2>&1; then
  echo "MySQL did not become ready in time" >&2
  exit 1
fi

sudo mysql <<'SQL'
CREATE DATABASE IF NOT EXISTS laundry_butler CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'butler'@'localhost' IDENTIFIED BY 'butler';
CREATE USER IF NOT EXISTS 'butler'@'%' IDENTIFIED BY 'butler';
GRANT ALL PRIVILEGES ON laundry_butler.* TO 'butler'@'localhost';
GRANT ALL PRIVILEGES ON laundry_butler.* TO 'butler'@'%';
FLUSH PRIVILEGES;
SQL

echo "MySQL is up and laundry_butler database is ready."
