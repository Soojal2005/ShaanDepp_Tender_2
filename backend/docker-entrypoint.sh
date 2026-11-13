#!/bin/sh
# Release step: apply any pending SQL migrations (backend/migrations), then start
# the API. Uses MIGRATION_DATABASE_URL / DIRECT_URL (the owner connection) the
# same way `npm run migrate` does — see docs/PRISMA_DEPLOYMENT.md. The runner is
# forward-only, checksums what it already applied, and takes a PostgreSQL
# advisory lock, so this is safe to run on every boot and under concurrent
# replicas: an up-to-date database costs one quick lock + a few lookups.
#
# If migrations fail, the container exits non-zero instead of starting the API
# against a schema the code doesn't match (which is what produced the "valid
# login -> 500" bug: migrations 012/013 sat unapplied while the code shipped
# ahead of them).
set -e
echo "[entrypoint] Applying database migrations..."
node src/db/migrate.js
echo "[entrypoint] Starting API..."
exec node src/server.js
