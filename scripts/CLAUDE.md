# scripts

Ops scripts run on h as root. The systemd units that call them live in `ops/`.

- `deploy.sh`: build committed HEAD into `release/`, restart, then poll
  `/health` for 20s. Fails loudly rather than rolling back: the release is
  already on disk and the service is already running it.
- `backup.sh`: the daily `pg_dump`. Writes a `.partial` and renames only
  after `gzip -t` passes, because `/health`'s `backup` check reads the newest
  file's age and a truncated dump would read as a fresh one.
- `restore.sh`: put a dump back into a named database. Refuses the live one
  without `--force`.
- `pgenv.sh`: sourced by the two above. Turns `.env`'s `DATABASE_URL` into
  libpq `PG*` variables rather than passing a URL on a command line: argv is
  world readable in `/proc`, a process environment is not. It then unsets
  `DATABASE_URL` and `SESSION_SECRET` so a script it is sourced into cannot
  leak them by accident.

## Gotcha
The app role has no `CREATEDB`, so `restore.sh` makes a missing target
database through `su postgres`. That `su` inherits the exported `PG*`
variables and would connect straight back as the app role, which is the role
that cannot create a database, hence the `env -u` in front of `createdb`.
