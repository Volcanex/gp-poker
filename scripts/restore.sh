#!/usr/bin/env bash
# Restore a dump written by backup.sh into a database.
#
#   scripts/restore.sh <dump.sql.gz> <database> [--force]
#
# The target is never the live database by default: restoring over
# `opentable` while the service is up drops tables out from under open
# connections, so that one target needs --force said out loud.
set -euo pipefail

usage() {
  echo "usage: $0 <dump.sql.gz> <database> [--force]" >&2
  exit 2
}

dump=${1:-}
target=${2:-}
force=${3:-}
[ -n "$dump" ] && [ -n "$target" ] || usage
[ -f "$dump" ] || { echo "no such dump: $dump" >&2; exit 1; }
[ -z "$force" ] || [ "$force" = "--force" ] || usage

repo=/home/gabriel/opentable
# shellcheck disable=SC1091
. "$repo/scripts/pgenv.sh"

live=$PGDATABASE
if [ "$target" = "$live" ] && [ "$force" != "--force" ]; then
  echo "refusing to restore over the live database '$live' without --force" >&2
  exit 1
fi

gzip -t "$dump"

export PGDATABASE=postgres
exists=$(psql -tAc "select 1 from pg_database where datname = '$target'")
if [ -z "$exists" ]; then
  # The app role has no CREATEDB, so a new target is made by the superuser
  # that already owns the cluster and handed to the app role. The PG* vars are
  # dropped for that one command: inherited, they would send the superuser's
  # shell back through TCP as the app role, which is the role that cannot do
  # this in the first place.
  [ "$(id -u)" = 0 ] || { echo "database '$target' does not exist and creating one needs root" >&2; exit 1; }
  su postgres -c "env -u PGHOST -u PGPORT -u PGUSER -u PGPASSWORD -u PGDATABASE createdb -O $(printf %q "$PGUSER") $(printf %q "$target")"
  echo "created database $target"
fi

export PGDATABASE=$target
gunzip -c "$dump" | psql -v ON_ERROR_STOP=1 --quiet >/dev/null
echo "restored $dump into $target"
