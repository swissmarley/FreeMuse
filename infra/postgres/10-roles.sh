#!/bin/sh
# Creates the least-privilege Sentinel role (grants are applied by migration 001).
set -e
if [ -n "$SENTINEL_DB_PASSWORD" ]; then
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'muse_sentinel') THEN
    CREATE ROLE muse_sentinel LOGIN PASSWORD '$SENTINEL_DB_PASSWORD';
  END IF;
END \$\$;
SQL
fi
