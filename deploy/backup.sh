#!/bin/sh
# Daily backup: a compressed database dump plus the uploaded case documents.
# Runs inside the "backup" container; keeps the last KEEP_DAYS days. Restore steps are in docs/OPERATIONS.md.
set -eu
KEEP_DAYS="${KEEP_DAYS:-14}"
mkdir -p /backups

while true; do
  stamp="$(date +%Y%m%d-%H%M%S)"
  echo "[backup] $stamp starting"
  if pg_dump --format=custom --no-owner | gzip -1 > "/backups/db-$stamp.dump.gz.tmp"; then
    mv "/backups/db-$stamp.dump.gz.tmp" "/backups/db-$stamp.dump.gz"
    tar -C /data -czf "/backups/files-$stamp.tar.gz" storage 2>/dev/null || echo "[backup] no uploaded files yet"
    echo "[backup] $stamp done"
  else
    rm -f "/backups/db-$stamp.dump.gz.tmp"
    echo "[backup] $stamp FAILED" >&2
  fi
  find /backups -type f \( -name 'db-*.dump.gz' -o -name 'files-*.tar.gz' \) -mtime +"$KEEP_DAYS" -delete
  # Once every 24 hours, counted from when the stack first started (start it around 02:00 for a night-time backup).
  sleep 86400
done
