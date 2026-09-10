# opentable

**Owner:** Gabriel Penman
**What:** Open Table, free ranked no-limit hold'em at
poker.gabrielpenman.com: six-max sit-and-go (the main game) and heads-up
(best of 25), each fast or standard and each rated or casual, with bots filling
empty seats in casual play. Lichess for poker: no money, no chips to buy, no
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
- `packages/solver`: real time CFR+ over one street of a heads-up subgame,
  and the range tracking that feeds it. What level 6 plays on, and nothing
  else uses it. Isomorphic; the river is solved exactly, the flop and turn
  are depth limited.
- `packages/identity`: generated CamelCase names (guests, bots) and
  deterministic geometric avatars from a user id. Pure, no dependencies.
- `server`: Fastify REST + `ws` WebSocket + `postgres` driver. Owns
  sessions, matchmaking queue, match orchestration, clocks, persistence,
  serving `client/dist`.
- `client`: React 19 + Vite + motion + number-flow + `@phosphor-icons/react`
  (the home page's secondary buttons and nowhere else yet). g-system vendored at
  `client/public/g/` (never hand-edited; re-vendor from the g-system repo).

## Decisions
- Modes: **six-max is the main game** (6 seats, last player standing, places
  by elimination order) with heads-up beside it (200 units, best of 25 hands
  or bust, equal stacks is a draw). Every table is 200 units a seat.
  `DEFAULT_FORMAT` and a bare `queue` message both mean standard six-max.
- **Speed is the second dimension**: `format.speed`, fast or standard, so there
  are four formats and eight queues (mode x rated x speed). A **standard** table
  is the game this site started with, a 20s clock and blinds climbing every
  8 hands six handed, with a ceiling of two hours. A **fast** table is the
  bullet game: a 10s clock and blinds climbing every 90 seconds of elapsed
  match time, with a ceiling of twenty minutes. Both ceilings are enforced by
  the blinds and not by a timer that stops a hand: the top level of every
  schedule has a big blind worth at least half the chips on the table, so
  each hand from there busts somebody. The arithmetic per format is written
  above it in `packages/protocol/src/index.ts` and held to its ceiling by
  `server/test/speed.test.ts`.
- **Ratings are per mode, not per speed** (`ratings` table). Four pools need
  four populations and this site has one, so speed rides along as a tag.
  Split them when the population supports it. Six-max gives each player one
  Glicko-2 period against every other seat by place.
- **A matchmade table asks before it deals.** Everybody at it accepts inside
  20 seconds (`server/src/ready.ts`); a decline or a silence drops the table,
  puts everybody who did accept back at the front of the queue, and costs the
  no-show two minutes, doubling for every further one inside the hour. The
  queue and the arena both use it. A link does not: a challenge and a home
  game are opened on purpose, and practice has nobody to wait for.
- **Rated play opens after one finished casual or practice match**
  (`RANKED_GATE_MATCHES`). Enforced at the queue and at an arena join, so a
  first ever hand cannot move a rating nobody knew they had. It is the only
  gate on this site: level unlocks nothing.
- **Level is matches finished**, level L at L(L+1)/2 of them, derived from the
  per-mode counters at read time rather than stored. It sits beside the name
  on a profile and in the top bar, and it unlocks nothing at all. Six badges
  hang off the same counters (`BADGES`, `badgesFor`), also derived and also
  functionally inert.
- Bots (`users.bot`) fill a heads-up seat after 5s and a **casual** six-max
  table after 20s of waiting, never a table with no human. **Rated six-max is
  people only** and waits for them: five bots at a table whose result moves a
  Glicko-2 rating is a rating anybody could dial in. Bot matches are
  otherwise rated for now, a bootstrap choice to revisit once there are
  users.
- **A bot plays a tier; a level is only where that tier sits on the ladder.**
  `BotTier` and `LEVEL_TIER` in the protocol are the map, and nothing branches
  on the number, so renumbering the ladder is a one-table edit. Seven tiers
  today (`users.bot_level`, `BOT_LEVELS`): station, loose, tight, solid, sharp,
  regular, solver. Solid is the bot that existed before levels and is still the
  default. The first five are one pure function of the view; **the last two
  think**, tracking both ranges through the hand and running CFR+
  (`packages/solver`) on the main thread in slices, because a worker would need
  a second bundle in production and a TypeScript loader in a worker in dev.
  `regular` plays the sharp tier everywhere except the river, which it solves
  exactly on a 400ms budget, and leans on measured reads of the particular
  opponent throughout; `solver` solves every postflop street on 1500ms. The
  population cycles the instant tiers by roster index; `THINKING_SEATS` gives
  three of its hundred and twenty a tier that thinks (two regular, one solver),
  so a ranked table sometimes seats a hard bot without the box paying for a
  hundred of them. The ordering of the instant tiers is proved by a seeded
  round robin through the engine (`server/src/bots/levels.test.ts`), not
  asserted by hand; a thinking tier's margin is measured by
  `server/scripts/bench-bots.ts`, because "beats the tier below" is a number
  with an interval rather than a test that passes. See
  `server/src/bots/CLAUDE.md` for why both are shaped the way they are.
- Practice mode is a `queue` message carrying `bots: {level}`. It skips the
  human queue, builds the table on the spot from bots at that level and
  outwards, and is **always unrated** (`format.practice`, persisted like every
  other format field). Casual and practice are both unrated, so only that flag
  tells them apart on a finished match.
- The bot population (`config.botCount`/`POPULATION_SIZE`, default 120,
  `server/src/bots/population.ts`) is a full roster of realistic-handled bots
  with countries, timezones, personas and a weekly schedule
  (`server/src/bots/population-roster.ts`), so the site reads as populated
  for testing. A scheduled-online bot joins the ordinary rated or casual
  queue through the exact dispatch path a socket message would, so it pairs
  with a human or another bot through the one pairing algorithm this site
  has — a human is never crowded out, since bot-fill timers and the ranked
  gate are untouched. `config.populationPublic`/`POPULATION_PUBLIC` (on
  whenever there is a population, off under vitest) is what puts the
  population's own matches, counts and ratings on `/api/live`, `/api/recent`,
  the leaderboard and profiles; off, the site behaves exactly as it did
  before the population existed. `scripts/population-reset.sql` is the
  documented, never-automatically-run way to wipe it back to nothing.
- The bot ladder (`server/src/ladder.ts`, `format.ladder`) is the one
  bot-only table there was before the population: bots play each other,
  rated, one match at a time, only while nobody is queued or playing.
  `server/src/index.ts` starts the population **or** the ladder, never both:
  the population does everything the ladder did (and does it in public), so
  the ladder is now the fallback for a box running with the population off.
  Off under vitest either way, `LADDER_ENABLED` and `LADDER_PAUSE_MS` on the
  box. Kept off `/api/live` and off `/api/recent` (unless `?ladder=1`)
  regardless of `POPULATION_PUBLIC`: it exists to make ratings real, not to
  be watched.
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
- **Friends are claimed accounts on both sides** (`friendships`,
  `server/src/friends.ts`, `/friends` on the client). A guest's name is
  generated for a browser and handed out again, so a friendship with one names
  somebody who may never be seen twice; a guest who presses a friend control is
  offered the claim form instead, which costs them nothing since the rating and
  the histories are already theirs. Bots are never friends. One row per
  unordered pair with a unique index on it, so A asking B and B asking A are
  one edge: an ask that crosses theirs is the accept. A decline, a cancel and
  an unfriend all **delete** the row, because none of them is a state anybody
  should be shown later and the person who asked can ask again. Caps are 200
  friends and 20 requests waiting on an answer.
- **Presence is the socket, and an invite is a link.** A friend is online while
  `hub.isConnected` says so and playing while `roomForPlayer` does, the same
  bargain the arena makes about who is pairable, with the offline push
  debounced a few seconds so a reload does not flicker a list. Playing with a
  friend makes an ordinary challenge link or home game and pushes it to them
  (`friend_invites`), so there is exactly one path from two people to a table
  and nothing has to sweep an invite: whether it is worth anything is the
  link's own answer. A challenge link therefore carries a `speed` now, because
  an invite promises the table the person sending it plays.
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
- Tournaments (`server/src/tournaments/`, `format.tournament`) are the arena's
  sibling: a field that funnels up to a final rather than a rolling pairing with
  a running score. Three fixtures on a fixed calendar and no admin, the way
  arenas need none: a daily 32-seat heads-up bracket whose start rotates through
  three slots so it lands in somebody's evening wherever they are, a 36-seat
  Sunday shootout, and a 216-seat championship on the first Sunday of the month.
  The scheduler writes each fixture's next row as soon as the previous one
  starts, so registration is always open on exactly three and never on none.
  Every match is an ordinary **fast** match on its own public page, heads-up
  ones rated and six-max tables rated only with two humans at them, which is
  the home game's rule. Every seat answers a ready check at the top of each
  round; silence withdraws them and costs nothing else, since nobody is left
  waiting at a table that was never dealt. Places are the final table's own
  order at the top and the round somebody went out in below it, tied within a
  round. A field under four (bracket) or six (shootout) is cancelled rather than
  crowning somebody who beat nobody.
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
- Profile pictures are cropped and encoded in the browser to a 256 square under
  120 KB, and stored as bytes on the `users` row with an `avatar_v` that is
  bumped on every change so `/api/avatars/:id?v=N` is immutable. The server
  never decodes an image: it sniffs the magic number, which is what keeps a
  native image library off this box. `server/src/CLAUDE.md` and
  `client/src/ui/CLAUDE.md`.
- A palette (`client/src/palettes.css`, `data-palette`) re-declares g's twelve
  slate steps and their twelve alpha steps, so it colours the whole site and the
  felt at once while every component still reads only the alias layer. Slate is
  the default and carries no attribute; felt, sky and umber each declare a full
  scale for dark and for light, and each arrives wearing its own accent.
- The games room (`client/src/room.css`, `data-theme="room"`) is the fourth
  theme and the default for a visitor who has chosen nothing: a coordinated
  set (walnut, baize, cream, brass, deep red) declared as tokens in that one
  file, the deliberate exception to reskin-by-accent-only. The palette and
  accent are kept but not worn while it is on. `client/src/ui/CLAUDE.md`.
- Auth: a guest user is minted on first visit (cookie session), named by
  `@opentable/identity`'s `generateName` (`guest` boolean column, not a name
  prefix). Claiming sets a name and password on the same row so rating
  carries over.

## Docs
Every directory with non-obvious behaviour has its own `CLAUDE.md`. This file is
the entry point; the detail lives down the tree.

- `client/CLAUDE.md`, and under it `client/src/net/`, `client/src/table/`,
  `client/src/analysis/`, `client/src/replay/`, `client/src/routes/` (with
  `client/src/routes/learn/`), `client/src/review/`, `client/src/tools/`,
  `client/src/puzzles/`, `client/src/chat/`, `client/src/ui/`,
  `client/src/admin/`, `client/src/sound/` and `client/e2e/`
- `server/CLAUDE.md`, and under it `server/src/`, `server/src/match/`,
  `server/src/ws/`, `server/src/bots/`, `server/src/tournaments/` and
  `server/test/`
- one per workspace package: `packages/engine/`, `packages/equity/`,
  `packages/identity/`, `packages/preflop/`, `packages/protocol/`,
  `packages/rating/`, `packages/solver/`
- `ops/CLAUDE.md` for the systemd units, `scripts/CLAUDE.md` for the ops
  scripts, `server/scripts/CLAUDE.md` for the measurement ones

`AGENTS.md` beside any of them is a symlink to it.

## Gotchas
- g-system tokens: `--surface-1/-2`, `--bg`, `--text-primary/-secondary`,
  `--border`. There is no `--surface`. g-system 1.1.0 (vendored 2026-09-08)
  adds pixel line-heights `--lh-1..5`, control/row heights `--h-1..5`, the
  responsive `--gutter` and `--col-*` measures, and `.g-page`. `.page` in
  `client/src/app.css` uses `--gutter` and `--col-content`/`--col-page` rather
  than a hand-rolled max-width and padding; the phone breakpoint keeps a
  literal `--sp-3` on purpose, one step tighter than the system default.
- `phe` ranks: lower is better (1 = royal flush, 7462 = worst high card).
