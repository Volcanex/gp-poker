# Shared rules for every opentable workstream

Read the repo root `CLAUDE.md` first, then `server/CLAUDE.md`, `server/src/CLAUDE.md`,
`server/test/CLAUDE.md`, `client/CLAUDE.md`, `client/src/ui/CLAUDE.md`,
`client/src/net/CLAUDE.md` and `packages/protocol/CLAUDE.md`. Follow the
patterns you find there. Read `server/src/arena.ts`, `server/src/challenges.ts`,
`server/src/home-games.ts` and the client routes beside them as the worked
examples of a feature built end to end here.

## Your worktree
- You work ONLY in your worktree (named in your brief), on its branch, already
  created from master. `node_modules` is a tree of symlinks into the main
  checkout; `@opentable/*` point at your own packages. If you add a workspace
  package, say so in the report rather than running `npm install`.
- The worktree's `.env` points BOTH `DATABASE_URL` and `TEST_DATABASE_URL` at a
  private database `opentable_test_<name>`. Never edit `.env`. Never touch
  `/home/gabriel/opentable` (the live tree), never run `scripts/deploy.sh`,
  never restart a systemd unit, never psql the `opentable` database.
- Commit as you go on your branch with `git add <paths>` and plain `git commit`
  (imperative subject, body says why). Do not push. Do not merge master.

## Verify
- `npx tsc -p server/tsconfig.json` and `npx tsc -p client/tsconfig.json` from
  the worktree root, both clean.
- Server tests: `cd server && npx vitest run` (files run serially, real
  Postgres, your private DB). Write tests for every new server behaviour in the
  style of `server/test/arena.test.ts` and `challenge.test.ts`, using the seams
  documented in `server/test/CLAUDE.md`. Run the whole server suite at the end
  and report the numbers.
- Client unit tests: `npm test -w client` for anything pure you add.
- To look at the real UI: build the client (`npm run build -w client`), run the
  server against your private DB on a port of your own from the worktree root
  (`PORT=<your dev port> POPULATION_SIZE=15 npx tsx server/src/index.ts`, which
  serves `client/dist`), then drive it with Playwright from the repo's node
  (`node script.mjs` using `@playwright/test`'s chromium; WebKit is installed
  too). Screenshot every new page at 1280 wide and 390 wide and look at the
  images. Kill your server with `fuser -k <port>/tcp`, never `pkill -f`.
- Do not run the full Playwright e2e suite (`npm run e2e`): it is red at HEAD for
  reasons unrelated to you and it is load-sensitive. Add targeted e2e specs for
  your new pages only if `client/e2e/CLAUDE.md` shows a cheap way (the mock
  server); otherwise a Playwright script that exercises your pages against your
  dev server and asserts the DOM is enough. Never leave a browser seated at a
  live table.
- Check `free -m` before a build; another agent may be building. Under ~1.5 GB
  available, wait a minute and try again (earlyoom kills the largest process).

## UI rules (load the `g-design` skill before any client work)
- g-system components as shipped (`.card`, `.btn`, `.badge`, `.table`,
  `.empty`, `.tabs`, `dialog.dlg`, `window.g.toast`), styled only through the
  alias tokens (`--bg`, `--surface-1/-2`, `--text-primary/-secondary`,
  `--border`, `--sp-*`, `--h-*`, `--lh-*`). No raw hex, no raw scale steps.
- Sentence case everywhere. No em dashes. No middle dots. No emoji; Phosphor
  icons from `@phosphor-icons/react`.
- Calm, dignified, sparse. Copy is short declarative sentences in the voice of
  the existing pages. Nothing "tacky": no fire, no hype, no exclamation marks,
  no confetti. This is skilful poker for its own sake, with no money in it.
- Every routed page is `<main className="page ... stack">` and enters via the
  existing entrance system (`data-enter-ready` on blocks that fetch).
- Times are shown in the viewer's local time (`Intl.DateTimeFormat`), with a
  countdown where the existing arena card shows one.
- Add your page to the site shell's sidebar (`client/src/ui/shell.tsx`) in the
  section that fits, with a Phosphor icon.

## Wire and docs
- Any change to `packages/protocol` bumps `PROTOCOL_VERSION`. New REST shapes go
  in `client/src/net/types.ts` and `client/src/net/api.ts` like the existing ones.
- Schema changes are appended to `server/db/schema.sql` in the idempotent style
  already used there (`create table if not exists`, `alter table ... add column
  if not exists`), with the same kind of prose comment above each table saying
  why it is shaped that way.
- Update `CLAUDE.md` where the shape changed: a Decisions bullet at the root in
  the existing voice, and the directory docs for any directory you added to.
  `AGENTS.md` beside each is a symlink, so editing one edits both.
- Server-side background work follows the arena's two rules: nothing throws
  out of a tick, and everything a test needs to drive is an injectable seam
  rather than a wall clock.

## Report
When done, report tersely: what shipped (routes, tables, messages), the exact
verification commands with their results, screenshots' paths, and anything
left undone or uncertain. Do not claim a thing works without having run it.
