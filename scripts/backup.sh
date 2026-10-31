#!/usr/bin/env bash
# Daily dump of the live opentable database, run by opentable-backup.timer.
# Writes atomically (a .partial that is only renamed once gzip verifies), so
# the newest file in the directory is never a half written dump: /health
# reads that file's age and would otherwise call a truncated dump fresh.
set -euo pipefail

repo=/home/gabriel/gp-poker
dest=/home/gabriel/backups/opentable
keep=3
archive=${OPENTABLE_ARCHIVE:-r2:gabriel/h-archive$dest}
rclone=(rclone --config /home/gabriel/.config/rclone/rclone.conf --s3-no-check-bucket)

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

# Newest `keep` stay on disk; older dumps move to R2 and leave a restore note.
# Fourteen local dumps at ~450 MB filled h on 2026-10-31 and failed that
# day's dump. Sorted by name, which is the date, so a clock that jumps does
# not reorder the history. A dump only leaves disk once R2 has the same md5.
for old in $(ls -1 "$dest"/opentable-*.sql.gz 2>/dev/null | sort -r | tail -n +$((keep + 1))); do
    name=$(basename "$old")
    "${rclone[@]}" copyto "$old" "$archive/$name"
    [ "$("${rclone[@]}" md5sum "$archive/$name" | cut -d' ' -f1)" = "$(md5sum "$old" | cut -d' ' -f1)" ]
    printf 'Archived to %s on %s. Restore: %s copyto %s %s\n' "$archive/$name" "$(date -u +%F)" \
        "${rclone[*]}" "$archive/$name" "$old" >"$old.ON-R2.txt"
    rm -f "$old"
done

echo "wrote $out ($(du -h "$out" | cut -f1))"
