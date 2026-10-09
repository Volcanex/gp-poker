#!/usr/bin/env bash
# Deploy everyonepoker.com from committed HEAD, never from the working
# tree: agents build in the working tree while the site is live, so the
# service serves a release copy under release/ that only this script writes.
set -euo pipefail
repo=/home/gabriel/gp-poker
wt=/home/gabriel/opentable-release
rev=$(git -C "$repo" rev-parse HEAD)
if [ ! -d "$wt" ]; then git -C "$repo" worktree add "$wt" "$rev" >/dev/null; else git -C "$wt" checkout -q --detach "$rev"; fi
[ -e "$wt/node_modules" ] || ln -s "$repo/node_modules" "$wt/node_modules"
(cd "$wt" && npm run build -w client >/dev/null && npm run build -w server >/dev/null)
rm -rf "$repo/release/client.new" && cp -r "$wt/client/dist" "$repo/release/client.new"
rm -rf "$repo/release/client" && mv "$repo/release/client.new" "$repo/release/client"
rm -rf "$repo/release/server.new" && cp -r "$wt/server/dist" "$repo/release/server.new"
rm -rf "$repo/release/data.new"; [ -d "$wt/server/data" ] && cp -r "$wt/server/data" "$repo/release/data.new" || true
rm -rf "$repo/release/server" && mv "$repo/release/server.new" "$repo/release/server"
[ -d "$repo/release/data.new" ] && { rm -rf "$repo/release/data"; mv "$repo/release/data.new" "$repo/release/data"; } || true
rm -rf "$repo/release/db.new" && cp -r "$wt/server/db" "$repo/release/db.new" && rm -rf "$repo/release/db" && mv "$repo/release/db.new" "$repo/release/db"
systemctl restart opentable

# A build that boots and then fails its own health check is worse than one
# that never boots: nothing pages and the site sits broken. Poll /health until
# it says ok, and make a deploy that never gets there loud rather than silent.
# Nothing is rolled back: the release is already on disk and the service is
# already running it, so this is a report, and the fix is the next deploy.
healthy() {
  local body=$1
  [ -n "$body" ] || return 1
  printf '%s' "$body" | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try { process.exit(JSON.parse(s).ok ? 0 : 1); } catch { process.exit(1); }
    });'
}

deadline=$((SECONDS + 20))
body=
while :; do
  body=$(curl -s --max-time 3 http://127.0.0.1:8130/health || true)
  if healthy "$body"; then
    echo "deployed $rev"
    printf '%s\n' "$body"
    exit 0
  fi
  [ "$SECONDS" -lt "$deadline" ] || break
  sleep 1
done

{
  echo "DEPLOY FAILED: $rev is running but /health did not report ok within 20s"
  if [ -n "$body" ]; then printf 'last /health: %s\n' "$body"; else echo 'last /health: unreachable'; fi
  journalctl -u opentable -n 40 --no-pager
} >&2
exit 1
