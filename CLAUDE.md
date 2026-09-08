# opentable

**Owner:** Gabriel Penman
**What:** Open Table, free ranked no-limit hold'em at
poker.gabrielpenman.com: heads-up (best of 25) and six-max sit-and-go,
each rated or casual, with bots filling empty seats. Lichess for poker: no money, no chips to buy, no
rake, no ads. Chips are table units that reset every match; the scarce
currency is Glicko-2 rating. Instant play as a guest, claim the account
later. Every match has a permanent public URL with hand histories, a
provably fair shuffle and preflop accuracy scoring.

## Run
systemd unit `opentable`, port 8130, `node release/server/index.js`. nginx
vhost proxies `/` and upgrades `/ws`. Local: Postgres on 5432 (`docker
compose up -d db` if there is none), copy `.env.example` to `.env`, then
`npm install && npm run dev` (builds the client, starts the server with
tsx, serves everything on one port). Tests: `npm test` (vitest in every
workspace). Deploy on h: `scripts/deploy.sh` (builds committed HEAD in a clean
worktree into `release/`, which the service serves via `CLIENT_DIST`;
never deploy the working tree, agents build in it while the site is live).
Schema in `server/db/schema.sql` is applied idempotently at start.
The server build is an esbuild bundle (`server/build.mjs`) because the
workspace packages ship TypeScript source only; `server/tsconfig.json` is
type-check only. Matches left `playing` by a dead process are aborted at
boot, unrated. `scripts/deploy.sh` then polls `/health` for 20s and exits 1
with the journal tail if it never reports `ok`, so a build that boots broken
is loud.

`/health` follows gcore's contract: always 200 while the process answers,
with `db`, `bots`, `ladder`, `disk` and `backup` under `checks`
(`server/src/health.ts`). Its top-level `ok` is the and of all five, which is
what the deploy gate and brain's L5 probe both read. A stale backup fails a
deploy, deliberately.

Backups: `ops/opentable-backup.timer` runs `scripts/backup.sh` daily at
04:30 UTC, keeping the last 14 gzipped `pg_dump`s in
`/home/gabriel/backups/opentable/`. `scripts/restore.sh <dump> <database>`
puts one back, and refuses the live database without `--force`. The unit
files live in `ops/`; see `ops/CLAUDE.md` for how they are installed and
`scripts/CLAUDE.md` for what each script is careful about.

## Shape (npm workspaces, TypeScript end to end, Node 22)
- `packages/protocol`: the wire types and the per-viewer `TableView`. The
  contract between server and client; bump `PROTOCOL_VERSION` on change, and
  read the current number off that constant rather than out of a doc.
- `packages/engine`: pure NLHE engine, 2..9 seats, side pots, deterministic
  deck from a seed. `packages/engine/src/types.ts` is its public contract.
  Hand strength via `phe`; `pokersolver` is only a test-time reference
  evaluator.
- `packages/rating`: Glicko-2 (tau 0.75, per-match update, RD widened on
  inactivity, provisional while RD > 110) and the matchmaking pairing
  function (pure, ticked by the server).
- `packages/preflop`: cached baseline HU charts by stack depth and the
  EV-lost scorer. Preflop only, no solver at runtime.
- `packages/equity`: postflop analysis (hand naming, exact or sampled
  equity, outs, range notation). Isomorphic, runs in the client's worker.
- `packages/identity`: generated CamelCase names (guests, bots) and
  deterministic geometric avatars from a user id. Pure, no dependencies.
- `server`: Fastify REST + `ws` WebSocket + `postgres` driver. Owns
  sessions, matchmaking queue, match orchestration, clocks, persistence,
  serving `client/dist`.
- `client`: React 19 + Vite + motion + number-flow. g-system vendored at
  `client/public/g/` (never hand-edited; re-vendor from the g-system repo).

## Decisions
- Modes: heads-up (200 units, blinds 1/2 flat, best of 25 hands or bust,
  equal stacks is a draw) and six-max (6 seats, blind levels every 8 hands,
  last player standing, places by elimination order). Each rated or casual.
  20s decision clock, 15s reconnect grace; three consecutive timeouts
  forfeit heads-up but only sit a player out in six-max.
- Ratings are per mode (`ratings` table), like chess time controls. Six-max
  gives each player one Glicko-2 period against every other seat by place.
- Bots (`users.bot`) fill a heads-up seat after 5s and a six-max table after
  20s of waiting, never a table with no human. Bot matches are rated for
  now: a bootstrap choice to revisit once there are users.
- Bots play at one of five levels (`users.bot_level`, `BOT_LEVELS` in the
  protocol), 1 loose and passive up to 5 sharp. Level 4 is the bot that
  existed before levels and is still the default. The roster is 15, three per
  level, generated from the same seed so the first eight names never moved.
  The ordering is proved by a seeded round robin through the engine
  (`server/src/bots/levels.test.ts`), not asserted by hand; see
  `server/src/bots/CLAUDE.md` for why that test is shaped the way it is.
- Practice mode is a `queue` message carrying `bots: {level}`. It skips the
  human queue, builds the table on the spot from bots at that level and
  outwards, and is **always unrated** (`format.practice`, persisted like every
  other format field). Casual and practice are both unrated, so only that flag
  tells them apart on a finished match.
- The bot ladder (`server/src/ladder.ts`, `format.ladder`) is the one bot-only
  table there is: bots play each other, rated, one match at a time, only while
  nobody is queued or playing, so the levels spread out on their own and the
  practice picker's per-level average is a number somebody earned instead of
  fifteen bots reading 1500. Off under vitest, `LADDER_ENABLED` and
  `LADDER_PAUSE_MS` on the box. Kept off `/api/live` and off `/api/recent`
  (unless `?ladder=1`): nobody played them, but they are stored and replayable
  like any other match.
- Play a friend is a link, not a queue (`challenges` table,
  `server/src/challenges.ts`, `/c/:id` on the client). A link is capped at five
  open per player and lives 24 hours; accepting it is what creates the match,
  through the same `createMatchForPlayers` the queue uses, so both sides are
  told by the same `q found` and the creator's waiting card navigates without
  knowing a challenge existed. Heads-up only: a six-max link has to gather six
  people, which is a lobby and a different feature (see the next bullet).
  `expired` is derived from `expires_at` when a row is read and never stored,
  so no sweep has to run for a status to be true.
- A home game is that lobby (`home_games` / `home_game_seats`,
  `server/src/home-games.ts`, `/g/:id` on the client): a private six-max table
  a host gathers by link and starts when they like, because six seats cannot
  start themselves the way two can. The host holds a seat like everybody else,
  three lobbies are open per host at once, and the host's start creates the
  match through the same `createMatchForPlayers`, filling whatever nobody took
  with bots at their chosen level through the practice picker's own
  nearest-level fallback. It is **rated only with two humans in it**, forced
  casual otherwise with the answer saying so: six seats of Glicko-2 against
  bots whose strength the host picked is a rating anyone could dial in.
  `format.homeGame` marks the match for the feed, and everyone seated is
  pushed a `lobby` message so the page fills in without polling.
- Arenas (`server/src/arena.ts`, `format.arena`) are the competitive loop: one
  half-hour heads-up event on every hour, created ahead of time by the
  scheduler and needing no admin. Join and you are paired again the moment your
  match ends, by closest score then rating, with a bot after eight seconds
  alone and never more than six bots across the arena at once. Win two, draw
  one, three for a win with two already banked. The matches are ordinary rated
  heads-up matches, so the only running total on this site is the board itself
  (`arena_players`), which the streak bonus makes unavoidable: each result
  depends on the ones before it. Pairing stops three minutes before the end and
  started matches play out, so the board freezes when the last one settles.
- The engine only sees seats with chips; `hands.live_seats` maps engine
  seat to table seat and every stored log is in table seats.
- Insights (`/api/users/:name/insights`, the block under a profile's rating
  graph) are derived by replaying the player's stored hands through the
  engine, not by keeping counters as matches run: the betting rules stay in
  one place. Null below 20 hands in that mode, and null for any rate with no
  denominator. Memoised per (user, mode) on their latest finished match.
- Tests run against `TEST_DATABASE_URL` (opentable_test), never the live
  database. Restarting the service aborts live matches (unrated).
- Server authoritative. Clients send `act` with the hand number and action
  seq they believe they are acting at; stale or illegal actions are refused
  with `err`. Hole cards are stripped in `toView(state, viewerSeat)` on the
  server; nothing else ever serialises a `HandState`.
- Provably fair: 32-byte seed per hand, `sha256(seed)` shown before the
  deal, seed published when the hand ends. Deck = Fisher-Yates driven by
  HMAC-SHA256 counter DRBG over the seed. Verify: rehash, re-derive deck,
  compare to the recorded board and holes.
- Replay = `engine.replay(config, actions)`; the stored hand row holds
  seed, stacks, button and the action log, nothing derived is trusted.
- Auth: a guest user is minted on first visit (cookie session), named by
  `@opentable/identity`'s `generateName` (`guest` boolean column, not a name
  prefix). Claiming sets a name and password on the same row so rating
  carries over.

## Docs
Every directory with non-obvious behaviour has its own `CLAUDE.md`. This file is
the entry point; the detail lives down the tree.

- `client/CLAUDE.md`, and under it `client/src/net/`, `client/src/table/`,
  `client/src/analysis/`, `client/src/replay/`, `client/src/routes/` (with
  `client/src/routes/learn/`), `client/src/tools/`, `client/src/puzzles/`,
  `client/src/chat/`, `client/src/ui/`, `client/src/sound/` and `client/e2e/`
- `server/CLAUDE.md`, and under it `server/src/`, `server/src/match/`,
  `server/src/ws/`, `server/src/bots/` and `server/test/`
- one per workspace package: `packages/engine/`, `packages/equity/`,
  `packages/identity/`, `packages/preflop/`, `packages/rating/`
- `ops/CLAUDE.md` for the systemd units, `scripts/CLAUDE.md` for the ops scripts

`AGENTS.md` beside any of them is a symlink to it.

## Gotchas
- g-system tokens: `--surface-1/-2`, `--bg`, `--text-primary/-secondary`,
  `--border`. There is no `--surface`.
- `phe` ranks: lower is better (1 = royal flush, 7462 = worst high card).
