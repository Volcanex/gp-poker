# Sourced by the ops scripts. Turns the repo .env's DATABASE_URL into libpq
# PG* variables so no password ever reaches a command line: argv is world
# readable in /proc, the environment of a process is not.
# shellcheck shell=bash
_pgenv_repo=${PGENV_REPO:-/home/gabriel/opentable}

set -a
# shellcheck disable=SC1091
. "$_pgenv_repo/.env"
set +a
: "${DATABASE_URL:?DATABASE_URL is not set in $_pgenv_repo/.env}"

eval "$(python3 - <<'PY'
import os, shlex, urllib.parse as u

p = u.urlparse(os.environ['DATABASE_URL'])
out = {
    'PGHOST': p.hostname or '127.0.0.1',
    'PGPORT': str(p.port or 5432),
    'PGUSER': u.unquote(p.username or ''),
    'PGDATABASE': u.unquote(p.path.lstrip('/')),
}
if p.password:
    out['PGPASSWORD'] = u.unquote(p.password)
for k, v in out.items():
    print(f'export {k}={shlex.quote(v)}')
PY
)"
unset DATABASE_URL TEST_DATABASE_URL SESSION_SECRET
