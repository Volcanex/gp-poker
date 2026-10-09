#!/usr/bin/env bash
# Daily dump of the live opentable database, run by opentable-backup.timer.
# Writes atomically (a .partial that is only renamed once gzip verifies), so
# the newest file in the directory is never a half written dump: /health
# reads that file's age and would otherwise call a truncated dump fresh.
set -euo pipefail

repo=/home/gabriel/gp-poker
dest=/home/gabriel/backups/opentable
keep=14

# shellcheck disable=SC1091
. "$repo/scripts/pgenv.sh"

mkdir -p "$dest"
out="$dest/opentable-$(date -u +%Y%m%d).sql.gz"
tmp="$out.partial"
trap 'rm -f "$tmp"' EXIT

pg_dump --no-owner --no-privileges --clean --if-exists | gzip -9 >"$tmp"
gzip -t "$tmp"
mv "$tmp" "$out"
trap - EXIT

# Newest `keep` kept, everything older dropped. Sorted by name, which is the
# date, so a clock that jumps does not reorder the history.
ls -1 "$dest"/opentable-*.sql.gz 2>/dev/null | sort -r | tail -n +$((keep + 1)) | xargs -r rm -f

echo "wrote $out ($(du -h "$out" | cut -f1))"
