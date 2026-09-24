# ops

The systemd units for EveryonePoker, tracked here and copied to
`/etc/systemd/system/` on h. The repo is the source; the installed copies are
disposable, so a unit edited only in `/etc` will be silently reverted by the
next install.

## Install
```
cp ops/*.service ops/*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now opentable-backup.timer
```
`daemon-reload` picks up a changed `opentable.service` for the *next* start.
It does not restart a running service, and neither should you by hand: the
new unit takes effect when `scripts/deploy.sh` restarts it.

## The units
- `opentable.service`: the site. `Restart=always`: an external SIGTERM
  (earlyoom, which runs on h and kills the biggest process under 6% free
  memory) ends in `server/src/index.ts`'s clean shutdown path, exit 0, and
  `on-failure` left the site down for eight hours on 2026-09-24 because of it.
  `systemctl stop` is never restarted whatever `Restart=` says. No
  `EnvironmentFile`; the server loads the repo `.env` itself
  (`server/src/config.ts`), so the secrets live
  in one place and the unit never holds a copy.
- `opentable-backup.service` / `.timer`: `scripts/backup.sh` daily at 04:30
  UTC, `Persistent=true` so a box that was off catches up. Dumps land in
  `/home/gabriel/backups/opentable/`, last 14 kept.

## Why /health cares about the backup
`scripts/backup.sh` writes to a `.partial` and only renames once `gzip -t`
passes, because `/health`'s `backup` check reads the newest file's age. Without
the rename, a dump that died half way through would be the newest file and
would read as fresh.
