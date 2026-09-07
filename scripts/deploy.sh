#!/usr/bin/env bash
# Deploy poker.gabrielpenman.com from committed HEAD, never from the working
# tree: agents build in the working tree while the site is live, so the
# service serves a release copy under release/ that only this script writes.
set -euo pipefail
repo=/home/gabriel/opentable
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
systemctl restart opentable
sleep 2
curl -sf http://127.0.0.1:8130/health >/dev/null && echo "deployed $rev"
