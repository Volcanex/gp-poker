# server

Fastify REST + WebSocket + `postgres` driver for Open Table. Owns sessions,
matchmaking, match orchestration, clocks, persistence, and serving
`client/dist`. See the repo root CLAUDE.md for the overall shape and
decisions; this file covers what's not obvious from the code.

## Structure
- `src/config.ts` — env from the repo-root `.env` via `process.loadEnvFile`
  (no dotenv dependency). `DATABASE_URL` and `SESSION_SECRET` are required;
  `PORT`/`HOST` default to 8130/127.0.0.1. Under vitest it resolves
  `TEST_DATABASE_URL` instead (see "The test database").
- `src/db.ts` — the `postgres` client (camelCase column transform both ways
  via `postgres.camel`) and every typed query the rest of the server uses.
  `applySchema()` applies `db/schema.sql` idempotently inside a transaction
  holding a `pg_advisory_xact_lock`, so concurrent boots (parallel test
  workers, a rolling deploy) don't race on `create extension if not exists`
  and friends — Postgres's own IF NOT EXISTS isn't safe under concurrency.
  `sql.json()` needs a value typed with an index signature; the `jsonb()`
  helper is the one cast boundary for that mismatch, since named interfaces
  like `MatchFormat` don't have one even though they're plain JSON.
  Protocol v2 added four columns and a table, all additive and applied by the
  same idempotent `schema.sql`: `users.bot`, `matches.places`,
  `match_players.place`, `hands.live_seats`, `rating_history.mode`, and the
  `ratings` table (see "Ratings are per mode").
- `src/auth.ts` — guest minting, scrypt password hashing, session cookies.
- `src/userView.ts` — `UserRow` → wire `UserSummary`. `isProvisional`
  delegates to `@opentable/rating`'s own threshold rather than keeping a
  second constant that could drift from it (the leaderboard SQL's
  `rd <= 110` is the one unavoidable duplicate, since SQL can't call into
  the package — commented at the query).
- `src/insights.ts` — the pure derivation behind `/api/users/:name/insights`.
  No database, no clock, no Fastify: hands in, one `Insights` out, which is
  why `src/insights.test.ts` can drive it with synthetic action logs. See
  "Insights".
- `src/explorer.ts` — the pure derivation behind `/api/explorer` (the opening
  explorer at `/tools/explorer`): every finished hand of a mode replayed into
  one cube of (position, facing, hand class) tallies that `sliceExplorer` reads
  a selection out of. The cube is **added to rather than rebuilt** and the route
  tops it up once a minute, because replaying the whole corpus every time a
  match finished would block the event loop for the best part of a second. It
  is also the one route that overrides `app.ts`'s blanket `no-store` on `/api`:
  it is the same public aggregate for everybody, so it is cacheable.
- `src/routes.ts` — all REST endpoints. Protocol v2 changes:
  - `/api/me`, `/api/claim`, `/api/login` and `hi` all carry a `UserSummary`
    whose `ratings` is a mode-keyed map of `{rating, rd, provisional, peak,
    peakAt, matches, wins, losses, draws}` (`peakAt` is ISO, null until the
    mode has been played). The flat `rating`/`rd`/`provisional` (and
    `/api/me`'s and `/api/users/:name`'s flat `peak`/`peakAt`/`matches`/
    `wins`/`losses`/`draws`) stay as the heads-up values for compatibility.
    Every flat field is read straight off the heads-up standing rather than
    recomputed beside it, so a client that falls back from a null per-mode
    value to the flat one can never be handed a different answer.
  - `/api/leaderboard?mode=heads-up|six-max`, defaulting to heads-up; an
    unrecognised mode falls back rather than erroring. The response is still
    a bare array.
  - `/api/users/:name` returns the same map on `summary.ratings`, and its
    `ratingHistory` is now mode-keyed (`{"heads-up": [...], "six-max":
    [...]}`). Its top-level `peak`/`peakAt`/`provisional`/`matches`/`winRate`
    are the heads-up ones. `lastMatches` entries carry `mode`, `players`,
    `place` and `rated`, so a client can render "3rd of 6" without a second
    request.
  - `/api/matches/:id` adds `places` and a per-hand `liveSeats`, and its
    per-hand `accuracy` is one entry per table seat (null throughout for
    six-max, which stores no study).
  - `/api/hands/:id` adds `liveSeats` and reports the hand's own `sb`/`bb`
    from `blindsAt` rather than the format's level-1 blinds, which is what a
    replay needs to rebuild the engine config.
  - `/api/puzzles/hand` returns one real preflop decision for the puzzle at
    `/puzzles/hand`: a random finished, non-practice, heads-up hand whose
    action log holds a spot the charts have an answer for, with the seat to
    grade and the index of that action in the log. The walk is done here
    so the random pick and the "has a gradeable spot" filter happen in one
    query rather than the client fetching hands until one fits; the client
    replays the log to that index itself. 404 while no such hand exists.
  - `/api/users/:name/insights?mode=heads-up|six-max` is how somebody plays
    rather than how they are rated, derived from their stored hands. Same
    mode fallback as the leaderboard. See "Insights".
  - **`/api/users/:name`'s `stats.vpip`, `stats.pfr`,
    `stats.aggressionFrequency` and `stats.foldTo3bet` are no longer read by
    anything.** The profile printed them as a "play style" block over the
    player's whole history; the insights route gives the same four rates per
    mode, and one page carrying both meant two different numbers under one
    label. The block is gone and these four are removable after a deploy
    cycle, along with the matching fields on `getUserHandStats`'s aggregate.
    `stats.hands` stays: the profile still prints how many hands the preflop
    accuracy was averaged over.
- `src/matchmaking.ts` — the in-memory queues and their tick. `matchFormat`
  exposes the same resolver the queue reads, so a match created outside the
  queue honours a test's `setFormatResolver` too.
- `src/challenges.ts` — "play a friend": a link instead of a queue. Creating
  one writes a `challenges` row, capped at five open per player and alive for
  24 hours; accepting it claims the row with a conditional UPDATE (so two
  people opening the same link cannot both be seated) and then calls
  `createMatchForPlayers`, which announces the table to both sides with the
  ordinary `q found`. `expired` is derived from `expires_at` at read time and
  never written, so the table needs no sweeper. Heads-up only.
- `src/home-games.ts` — the six-max version of that link, and a different file
  rather than a mode of the same one for a reason: two people can be seated by
  the second one accepting, six cannot, so a home game is a **lobby** with a
  host who says when it starts. Creating one writes a `home_games` row (capped
  at three open per host, alive 24 hours) and seats the host in
  `home_game_seats`, so the seat table is the whole guest list and `host_id`
  only says whose table it is. The capacity test lives inside the seating
  insert, so six people opening the link at the same moment cannot all sit at a
  table with six chairs. Starting claims the row with a conditional UPDATE (a
  host double-clicking cannot open two tables), fills the empty seats with
  `availableBotsAtLevel` and calls the same `createMatchForPlayers` everything
  else does, so every seat is told by the ordinary `q found`. **Rated needs two
  humans**: one person and five bots of a strength they chose is a rating that
  could be dialled in, so the match is forced casual and the response says
  which choice was overridden rather than changing it quietly. The format
  carries `homeGame: true` for the feed's badge. `expired` is derived from
  `expires_at` at read time, like a challenge's. Everyone seated is pushed a
  `lobby` message on every seat or status change, which is what lets the page
  fill in without polling; a page whose socket is not open falls back to asking
  again every five seconds.
- `src/chat.ts` — the pure half of table chat: `cleanChatText` (control
  characters out, one line, length, links) and `ChatLimiter` (a gap between one
  person's messages and a total for the match). The clock is a parameter, so
  the twenty-message cap is a unit test rather than forty seconds of waiting.
- `src/bots/` — the bot roster (`index.ts`), one bot's message loop
  (`player.ts`) and the pure decision function (`strategy.ts`). The five
  levels, the roster's shape and why the ordering test looks the way it does
  are in `src/bots/CLAUDE.md`.
- `src/ws/hub.ts` — connection registry + the raw per-socket protocol
  handling (decode, `hi`, ping/pong, audit log). Knows nothing about
  matchmaking or match rooms; dispatch is injected.
- `src/ws/router.ts` — routes `queue`/`dequeue`/`join`/`leave`/`act` to
  matchmaking and match rooms; the one place that imports both.
- `src/match/types.ts` — `RoomClock`, `HandRunner`, `MatchOutcome`: the seam
  itself, in its own file so `room.ts` and `handRunner.ts` can both import it
  without importing each other.
- `src/match/room.ts` — `MatchRoom`: subscribers, the decision clock,
  disconnect grace, persistence and rating writeback on finish. Talks to hand
  state only through the `HandRunner` interface, and constructs the concrete
  `EngineHandRunner` itself in `start()`.
- `src/match/handRunner.ts` — `EngineHandRunner`: the `HandRunner`
  implementation over a live `@opentable/engine` `HandState`, plus
  `@opentable/preflop` scoring on hand completion. See below.
- `src/match/rating.ts` — `computeMatchRatings`: the one place that calls
  into `@opentable/rating`'s `widenRd`/`updateRating` for a finished match.
  Shared by the hand runner (natural end) and `MatchRoom` (forced forfeit) so
  there's exactly one implementation of "how a match result becomes a rating
  change."
- `src/match/rooms.ts` — room registry, by match id and by player id (for
  routing disconnects/reconnects to the right room without scanning all of
  them).
- `src/app.ts` — builds the Fastify instance (routes, cookie/websocket/static
  plugins, `/ws` auth), aborts any match left `'playing'` from a previous
  process, without listening or starting matchmaking's tick, so tests can
  build it, inject into it, and control timing themselves.
- `src/meta.ts` — what a pasted link shows: the built `index.html` read once
  at boot, with a per-request `<title>`, description, Open Graph and Twitter
  card tags injected for matches, hands, profiles, challenges and the static
  pages, plus `/robots.txt` and `/sitemap.xml`. `index.html` is deliberately
  excluded from `@fastify/static` (`globIgnore`), so `/` and every client
  route reach the shell through the not-found handler and nothing can serve
  the generic head; per-id lookups are cached 10s and any miss or failure
  falls back to the plain shell with a 200.
- `src/index.ts` — thin: build, start matchmaking, listen, graceful shutdown.
- `build.mjs` — the production build (see "Building for production" below).

## Auth model
A guest is minted on any request that lacks a valid `ot_session` cookie
(`auth.requireUser`, used by `/api/me` and anything else that should always
have a "current user"). The cookie is httpOnly, `SameSite=Lax`, 90 days, and
`secure` when `X-Forwarded-Proto: https` (nginx terminates TLS) or the
request itself is https. Guest names come from `@opentable/identity`'s
`generateName`: a two-word CamelCase name (`RedTiger`), retried up to 4
times on collision, then three-word names until one is unique. Guests are
identified by the `guest` boolean column, not a name prefix — `guest-` stays
reserved (see `validateName`) so nobody can claim a name that looks like the
old convention. Claiming sets `name` and
`password_hash` on the *same* row (`guard: guest = true`), so rating and
history carry over. Password hashing is `crypto.scrypt`, stored as
`salt:hash` hex. The websocket path uses `resolveSessionUser` instead — it
does **not** mint a guest; `/ws`'s `preValidation` hook rejects the upgrade
with 401 if there's no valid session, since the client always calls
`/api/me` first to get one.

## Ratings are per mode
A rating belongs to a (user, mode) pair, the way a chess site keeps bullet
and blitz apart. The `ratings` table is the home of the Glicko-2 state now:
`(user_id, mode)` primary key, the same columns `users` used to hold
(`rating`, `rd`, `volatility`, `rating_at`, `peak_rating`, `peak_at`,
`matches`, `wins`, `losses`, `draws`).

Rows are created lazily, on the first *finished* match in that mode, so a
guest who never plays leaves nothing behind. Every read goes through
`getRating(userId, mode)` / `getRatingsFor(userId)` /
`getRatingsForUsers(ids, mode)` in `db.ts`, which synthesise a fresh
1500/350/0.06 for a missing row: "has not played this mode" and "is unrated
in this mode" are the same thing, and no caller has to special-case it.

**The matching columns on `users` are legacy.** Nothing in the server reads
them. `db.finishMatch` mirrors the heads-up row into them after every
heads-up match so anything outside this codebase still sees something sane,
and `schema.sql` backfills `ratings` from them once (a plain
`insert ... select ... on conflict do nothing`, which re-runs harmlessly on
every boot). Delete the columns when nothing outside the server wants them.

`peak_rating` and `peak_at` mean "the best this player has ever been in this
mode, and when". Everyone starts at the default 1500, so a first match that
went badly peaks at 1500 with a **null** `peak_at`: nothing was exceeded, so
there is no moment to point at. Both branches of the upsert in
`db.finishMatch` have to agree about that, and originally they did not, which
made `peak_at` depend on whether the rating row happened to exist already
(the schema backfill creates rows for existing users, so under a parallel
test run it sometimes did). `peakAt` on the wire is ISO or null.

Everything downstream keys off the match's mode: the queue enters a player at
their rating *for the mode they queued for*, `MatchSeat.rating` (and so
`SeatView.rating`) is the mode's rating, bot picks compare on the mode's
rating, `rating_history` rows carry a `mode`, and the provisional flag,
peak and win/loss/draw counters are all per mode.

## Modes and formats
Two modes, each rated or casual, so four independent queues. `formatFor(mode,
rated)` in the protocol builds the `MatchFormat`; the server never invents
one. Heads-up is unchanged: two seats, 200 units, flat 1/2 blinds, 25 hands
or bust. Six-max is a sit-and-go: six seats, `hands: null`, and a nine-level
blind schedule (`levels`, `levelHands: 8`) so it always ends. Every hand asks
`blindsAt(format, handNumber)` for its level and `TableView.blinds` reports
it, which is the only place the client should read the current blinds from.

`format.rated` is what goes into `matches.rated`; a casual match plays
identically and settles differently (see "End conditions and rating").

## Table seats and engine seats
Table seats are 0..N-1 and fixed for the whole match. They are what the wire,
the database and `MatchRoom` all speak. The engine is only ever handed the
seats that still have chips, so its `HandConfig` indexes are a different,
shorter numbering that changes every hand.

`EngineHandRunner` owns the map (`liveSeats[engineSeat] = tableSeat`) and
translates everything crossing the boundary: actions in, views out, and the
stored action log, holes and hand result, all of which are persisted in TABLE
seats. The mapping itself is stored on the hand row as `live_seats`, which is
what lets a replay rebuild the same `HandConfig`:

```
config.seats  = live_seats.map(t => ({ id: seats[t].user_id, stack: stacks_start[t] }))
config.button = live_seats.indexOf(hands.button)   // hands.button is a table seat
actions       = stored.map(a => ({ ...a, s: live_seats.indexOf(a.s) }))
```

Heads-up `live_seats` is always `[0, 1]` (a bust ends the match), so the two
numberings coincide and nothing about existing matches changes. The button
starts on the lowest live seat and moves to the next live seat each hand,
skipping anyone who has busted. An eliminated player keeps their seat in the
view with `out: true` and their `place`; `SeatView.bot` comes from
`users.bot`.

Preflop `study` and `stats` are heads-up only. `@opentable/preflop`'s charts
and spot walker model two players, so a six-max hand stores null for both
rather than a wrong number, and the profile aggregates already skip hands
with null stats.

## Matchmaking tick
`src/matchmaking.ts` keeps one in-memory `Map<userId, QueuedPlayer>` — nothing
here is persisted, so a server restart drops the queue (acceptable: clients
just re-send `queue`). Each entry carries its own `mode` and `rated`, and the
tick buckets them by `(mode, rated)`, which is what makes the four queues
independent without four maps. `enqueue` widens the user's RD for inactivity
via `@opentable/rating`'s `widenRd` before adding them (the rating row for the
mode being queued for, not their heads-up one), and immediately replies `q searching` with the mode, the rated flag, the current `window()`
range and, for a multiway table, `seated` (how many are gathered so far).

A 1s `setInterval` (`tick`, exported so tests can call it directly instead of
waiting on the real timer) walks each bucket:

- **heads-up** pairs humans with `pairQueue`, exactly as before.
- **six-max** gathers with `groupQueue(entries, 6, now)`: the longest waiter
  anchors a group and pulls in the closest-rated entries that sit inside its
  window and each other's. An anchor that cannot fill a whole table is left
  in the queue rather than half-consumed.

Creating the match allocates a short id (base32-ish, retried on the rare
collision), inserts `matches`/`match_players`, builds a `MatchRoom`,
registers it, and sends `q found` to every seat. Seat order is shuffled, so a
human is not always on the first button.

### Bot fill
Two constants at the top of the file, both measured from the longest wait in
that queue:

| queue | wait before bots come in |
|---|---|
| `BOT_FILL_HEADS_UP_MS` | 5s |
| `BOT_FILL_SIX_MAX_MS` | 20s |

Heads-up gives a lone human one bot. Six-max launches on six humans, or after
the threshold with bots in the remaining seats. Bots never fill a table with
no human, and a roster too short to fill the table waits rather than seating a
short-handed one. Candidates come from `availableBots(rating, n)`: loaded in
this process, not in a live match (a finished room lingers a minute, so this
asks `room.active`, not whether the room exists), closest in rating first.

`setFormatResolver` is a test seam in the same spirit as `tick` and
`createMatchForPlayers`: it swaps `formatFor` so the real queue path can run
against a short clock and a small stack.

## Bots
`src/bots/` exists so one human can play right now. A bot is an ordinary
`users` row with `bot = true`: a real name (a fixed list of fifteen CamelCase
names from `@opentable/identity`, generated once with a seeded rng so the
roster is stable across boots and growing it only appends), a level
(`bot_level`, 1..5, three bots each), a real Glicko-2 rating and real match
history, no password, never a guest. `ensureBots()` runs once in `buildApp`
and keeps `BOT_COUNT` (default 15, the whole roster) of them alive; the
insert is `on conflict do nothing` so parallel boots are safe, and the level
is re-asserted from the roster on every boot. `migrateBotRoster()`
(backed by `db.migrateLegacyBotNames`, advisory-locked so concurrent boots
can't race renaming the same row) runs first and one-time-renames any
pre-identity-package `bot-otter` style row into the new roster, in the same
`name_lower` order the old roster was read.

A bot has no socket. It registers a **virtual connection** with the hub
(`hub.attachVirtual`), and `hub.send` routes to that handler before it looks
for websockets, so rooms, the clock and persistence never learn the
difference; `hub.isConnected` counts it too, and since nothing ever closes,
a bot is `connected: true` for the life of the match. Messages go back out
through `routeClientMessage`, the same path a socket action takes, injected
via `setBotDispatch` in `app.ts` so `src/bots/` never imports the websocket
layer that imports matchmaking.

`BotPlayer` (`player.ts`) joins on `q found`, and on any `state` where
`legal` is non-null it decides immediately and *acts on a timer*: 600 to
1800ms normally, 100 to 400ms when the answer is a free check or it is
effectively all-in, capped at a quarter of `format.clockMs` (which is what
lets a test with a 300ms clock finish). Because the decision is made before
the timer is set, a bot cannot time out. Decisions are keyed by
`match:hand:seq` so a rebroadcast at the same decision point (an opponent
disconnecting, say) does not queue the action twice.

`strategy.ts` is pure and unit-tested, with the RNG injectable:

- **Preflop** starts from the hand class's percentile in
  `@opentable/preflop`'s equity ranking, jittered a few points so the bot is
  not a lookup table. Two-handed it reads the real charts: the stack bucket
  plus the spot (recovered from the two bets, since heads-up a seat that has
  put in more than a big blind has raised) give a chart entry, and
  `regionsOf` says aggr, passive or fold. Multiway it uses position-aware
  thresholds instead, because the charts model two players and applying them
  six-handed would be worse than a rule of thumb: raise the top 12% to 25%
  by position, call the top 40%, three-bet the top 6%, call a three-bet with
  the top 12%, and under 12bb jam the top 25% or fold.
- **Postflop** is hand strength, computed with `phe`: the fraction of the
  opponent two-card holdings still possible on this board that the bot's
  hand beats, ties counting a half (990 combinations on the flop). Above
  0.85 it bets or raises about two thirds of the pot; 0.55 to 0.85 it bets
  half pot when checked to and calls when the price beats its strength;
  below that it checks or folds unless the pot odds still justify a call,
  with an 8% bluff when checked to on the turn or river.
- Sizes are clamped to `legal.min..legal.max`, and a raise over 80% of the
  stack becomes `'a'`. Every decision leaves through `ensureLegal`, so an
  action the view did not offer degrades to check, else call, else fold
  rather than reaching the room.

Bots are excluded from the leaderboard (`getLeaderboard`'s `bot = false`) and
`/api/users/:name` reports `bot: true` for them. A bot's rating is per mode
like anyone else's, so `availableBots` compares on the mode being filled. **Bot matches are rated.**
That is a deliberate bootstrap choice while there is nobody else to play:
casual bot matches would leave every early human provisional forever with
nothing to calibrate against. Revisit once humans are pairing with humans.

## Spectating
A `join` for a match you have no seat in makes you a spectator: `MatchRoom`
keeps you in the same `subscribers` set the players are in and sends you
`viewFor(userId, ...)` with no seat, which is the existing per-viewer view
builder doing the existing stripping (`you: null`, `legal: null`, every hole
card `['?','?']` until `state.result.shown` reveals it). There is no second
view path to keep in step, which is the point. `handleAct` already refuses
anybody without a seat. A finished room lingers a minute, so a link followed
late still opens on the final board and the `end` that follows it.

The only thing spectators need beyond that is a lifetime: a player's
subscription survives their grace window, a spectator's does not, so
`rooms.ts` keeps a `bySpectator` map and `routeDisconnect` drops every table
that user was watching. Without it the subscriber set only ever grows.
`room.spectatorCount` is reported on `/api/live` and deliberately never sent
to the table.

## Table chat
`MatchRoom.handleChat` is the whole of it. **Two channels, one allowance.** A
seated player's line goes to every subscriber; a spectator's goes only to the
other spectators, which is what stops a table being coached from the rail, and
is why `ChatFrom.seat` being null is both "who said it" and "where it lands".
A player joining is replayed the table's channel, a spectator both of them
merged back into the order they were said in.

The two rings are capped separately (`CHAT_HISTORY` each) rather than as one
list of a hundred: a busy rail would otherwise evict the conversation a
reconnecting player came back for.

**The allowance is spent synchronously, before the name lookup is awaited.**
`handleChat` cleans the text, checks the limiter and records the send, and only
then awaits `getUserById` to find out who is speaking. Two messages arriving in
the same tick would otherwise both pass a check made after a database round
trip, and the gap that stops a flood would not exist. Content refusals run
before the limiter, so a rejected link costs nobody one of their twenty.

Bots never chat: nothing in `src/bots/` sends one, and `deliverChat` drops a
message from a `users.bot` row rather than repeating it as though a bot had.
The `chat` table is written as it is said and read by nothing: moderation is a
tool still to be built, not a route left open.

## HandRunner seam
`MatchRoom` (in `src/match/room.ts`) owns orchestration only — subscribers,
the wall clock, disconnect grace, persistence, rating writeback on finish —
and never touches a `HandState` directly. It talks to hand state only
through the `HandRunner` interface (`src/match/types.ts`):

```ts
interface HandRunner {
  startHand(number: number): Promise<void>;
  onAction(userId: string, msg: Extract<ClientMsg, { t: 'act' }>): boolean; // false = rejected, err already sent
  onTimeout(seat: number): void; // TABLE seat: apply check-if-legal-else-fold, log with to: true
  toActSeat(): number | null;
  isDone(): boolean; // true once the whole MATCH is decided, not just the current hand
  matchResult(): MatchOutcome | null;
  currentStacks(): Record<string, number>; // live stacks, for a forced forfeit mid-hand
  viewFor(userId: string | null, clock: RoomClock | null, connected: boolean[]): TableView | null;
}
```

`onAction` returns `boolean` rather than `void` (a small refinement over the
phase-one seam): `MatchRoom.handleAct` only rebroadcasts and rearms the clock
when something actually changed, otherwise a client spamming illegal actions
could keep resetting their own clock for free. `viewFor` takes the room's
clock and per-seat connectivity as parameters rather than the hand runner
tracking either itself — masking hole cards is the engine's job
(`visibleCards(state, viewerSeat)`), but *whose turn it is on the wall clock*
and *who's currently connected* are orchestration concerns the hand runner
shouldn't need to know about.

`EngineHandRunner` (`src/match/handRunner.ts`) is the implementation, over
`@opentable/engine`. Per match it tracks every table seat's running stack and
`place`, the live-seat map for the current hand, the current `HandState`, and
a `MatchOutcome | null` that's non-null once the whole match (not just a
hand) is decided. Every seat number on its public surface is a table seat.
Notable pieces:

- **startHand** collects the seats that still have chips, moves the button to
  the next live one (hand 1 puts it on the lowest live seat, which heads-up
  reproduces the old `(number - 1) % 2` rotation), reads the level from
  `blindsAt(format, number)`, allocates a fresh `newSeed()`, and `insertHand`s
  the row — seed hash, button, starting stacks for all N seats, `live_seats` —
  *before* calling `createHand`, so the commitment exists before any card is
  dealt even if the process dies immediately after. If everyone left is
  covered by the blinds alone, `createHand` itself resolves straight to
  `'done'` (see engine's CLAUDE.md); `startHand` handles that by immediately
  kicking off hand completion rather than assuming there's something to act
  on.
- **onAction** validates in the order the wire error codes imply: not this
  seat's turn → `err not_your_turn`; `msg.h`/`msg.n` mismatch the current
  hand/seq → `err stale`; otherwise hands off to `apply()`, which throws
  `IllegalAction` for anything else wrong (bad amount, wrong action for the
  spot, a garbage action kind that isn't in `legal().actions`) → `err
  illegal`. There's no separate "malformed message" branch: a missing or
  wrong-typed `h`/`n`/`a` just falls through the same checks and lands on
  `stale` or `illegal`, which is precise enough. On success it stamps the
  logged action's `t` (ms since hand start, the engine always writes `0`)
  and classifies what happened for `TableView.last` — see below.
- **onTimeout** applies `'x'` if legal for that seat, else `'f'`, stamping
  `to: true` on the logged action.
- **`TableView.last` classification**: after any transition, in priority
  order — hand just resolved (`prev.street !== 'done' && next.street ===
  'done'`) → `'showdown'` if anyone's cards were revealed
  (`result.shown` non-empty) else `'award'`; board grew → `'street'` with the
  newly-revealed cards; else `'timeout'` if the transition came from
  `onTimeout`, else plain `'act'`. `startHand` sets `'deal'` for hand 1,
  `'newhand'` for every hand after.
- **pot** is `sum(seat.committed)` — the engine's `committed` already
  accumulates across the whole hand including the current street's `bet`
  (`bet` resets to 0 each street, `committed` never does), so there's
  nothing to add on top.
- **Hand completion** (`completeHand`, triggered whenever `state.street`
  becomes `'done'`): persists the hand row (seed, actions, board, holes and
  `result`, all translated into table seats, plus `completedAt`, and
  heads-up only `stats` from `preflop.handStats` and `study` — per seat,
  `preflop.extractDecisions` filtered to that seat plus `summarise()` of
  them), updates the running stacks, bumps `hands_played`, then settles:
  `settleHeadsUp` (bust or `format.hands` reached) or `settleMultiway`
  (assign places to whoever busted, finish when one player is left). If
  neither ends the match it waits `min(HAND_HOLD_MS, format.clockMs)` — 4s in
  the product, long enough for the reveal to register, and never longer than
  the decision clock so a short test clock doesn't spend four seconds on a
  finished board — and then calls `startHand` for the next number.
- **onFail callback**: dealing the next hand and completing one are both
  detached async work, run from a timer or after an action has already
  returned, with nothing left to await their rejection. A failed write there
  used to become an unhandled rejection, which Node 22 ends the process over,
  taking every other live match down with it. Both routes now report to
  `onFail`, and `MatchRoom.abandon` stops the room's timers and unregisters
  it. Reproduce the old behaviour by deleting a `matches` row mid-match: the
  next `insertHand` hits a foreign key violation from inside the hand-hold
  timer.
- **onChange callback**: `MatchRoom.start()` hands the hand runner a closure
  that does `broadcast(); rearmClock(); settleIfDone()`. The room calls those
  itself right after any *synchronous* `onAction`/`onTimeout`, but starting
  the next hand or finishing the match both happen *after* the `HAND_HOLD_MS`
  wait or an async rating fetch — `onChange()` is what tells the room to
  react to those without giving the hand runner a reference to the room.

`MatchOutcome` (`src/match/types.ts`) is deliberately richer than the wire
`MatchResult`: it carries each player's post-match `volatility`, which
Glicko-2 needs internally but which the protocol never puts on the wire. It
also carries `places`, which the wire does take.
`finishMatch` projects it down to `MatchResult` for the `end` broadcast and
passes the full thing to `db.finishMatch` for persistence.

## End conditions, places and rating
Ways a match ends, all producing a `MatchOutcome` (which now always carries
`places`, one finishing position per user id, 1 = best):

- **bust, heads-up** — a stack hit 0 at hand completion. Winner 1, loser 2.
- **hands, heads-up** — `hands_played` reached `format.hands`; equal stacks
  is a draw (`winner: null`, both places 1).
- **bust, six-max** — one player holds every chip. Places are reverse
  elimination order: everyone knocked out in the same hand shares the block
  of places just below whoever is left, ordered by the stack they *started*
  that hand with, since the bigger stack outlasted the smaller one.
- **forfeit** — heads-up only, `MatchRoom`'s per-player consecutive-timeout
  counter hit 3 (see "Clock design"). It can fire mid-hand, before the hand
  runner ever reaches `isDone()`, so `MatchRoom.buildForfeitOutcome` computes
  the outcome itself rather than asking the hand runner for one.

Multiway never forfeits: handing the rest of the table a free elimination
because one seat went quiet is worse than the alternative. After three
timeouts that player is **sat out** instead: every decision is auto
check-folded the instant it reaches them (no clock burnt), blinds keep being
posted, and they play down to a bust like anyone else. Any `act` message
un-sits them, including one the room rejects, because the auto check-fold
fires the moment it becomes their turn and a returning player is always too
late to act cleanly.

### One rating period per match
`computeMatchRatings(players, places, rated)` in `src/match/rating.ts` is the
one place a finished match becomes a rating change, shared by
`finishNaturally` and `buildForfeitOutcome`. Both feed it the rating rows for
*this match's mode* and nothing else, so a six-max result can never move a
heads-up rating. Every player gets exactly **one**
Glicko-2 period holding a result against every other seat: 1 if their place is
better, 0 if worse, 0.5 if equal. Heads-up that reduces to the old
win/loss/draw update; six seats give each player five results in the one
period, which is what stops a sit-and-go being scored as five separate
matches. Each player's RD is widened for their own inactivity first
(`widenRd`, days since `rating_at`) and every opponent is fed in at their
widened rating too. `before`/`rdBefore` report the actual persisted pre-match
values, not the widened ones — widening is an input to the algorithm, not
something that happened to the player's record. Peak rating updates when the
new rating exceeds it (`db.finishMatch`'s SQL, `greatest(peak_rating,
new_rating)`).

A **casual** match (`rated: false`) returns an echo instead: after === before,
rdAfter === rdBefore. `db.finishMatch` then upserts counters only, leaving the
Glicko-2 columns, `rating_at` and the `rating_history` row alone. The win/loss/draw and
`matches` counters still move for every finished match either way: a casual
game was played, it just wasn't rated. Multiway has no draw, so first place
counts as a win and every other place as a loss.

## The rated flag has one source
`format.rated` is the only thing that decides whether a match is rated.
`matches.rated` is a copy of it: written from the format at insert, and
*re-asserted from it* in `db.finishMatch`, so the column cannot end up
disagreeing with the format it was copied from. `MatchRoom` reads
`this.rated` (a getter over `match.format.rated`) for the rating write and
for the `end` message, never the column.

This is not hypothetical tidiness. A match played on the live server came out
of it with `rated = false` in the row while its format said true and its
ratings had been written and persisted: a *test run pointed at the live
database* had called `abortStalePlayingMatches()` mid-match, which used to
set `rated = false`, and the live server's own finish never wrote the column
back. Two changes came out of that: the boot abort no longer touches `rated`
(see below), and the finish re-asserts it.

## Boot-time abort
There's no way to safely resume live in-memory hand state across a process
restart — the queue, every `MatchRoom`, and every `HandRunner`'s `HandState`
live only in memory. `db.abortStalePlayingMatches()` runs once at the start
of `buildApp()`, before anything else touches the match tables: any match
still `status = 'playing'` from a previous process is marked `'aborted'`,
`reason: 'abort'` — no rating change, no `rating_history` row. It does **not**
touch `rated`: that column means "this match's format was rated", and
`status`/`reason` plus the absence of a `ratings` payload are what say
whether a rating was actually written. Whoever was mid-match just sees the match gone; there's currently no
wire message for this since it only happens to matches nobody's connected to
by definition (the process that would broadcast it just died).

## Clock design
A fresh `clockMs`-long deadline starts (`rearmClock`) whenever
`hand.toActSeat()` changes to a new non-null seat, tracked in
`MatchRoom.clock: RoomClock | null` (`{ seat, deadline, paused }`) and armed
with a real `setTimeout`. On expiry (`handleClockExpiry`), the room calls
`hand.onTimeout(seat)` — the hand runner is responsible for checking if
legal, else folding, logging the action with `to: true` — then bumps that
player's consecutive-timeout counter; three in a row forfeits the match to
the opponent heads-up, or sits the player out multiway (see "End conditions,
places and rating"). A sat-out seat is never given a clock: `rearmClock`
queues its auto check-fold on a zero-delay timer instead, so a whole street
of sat-out seats unwinds as separate turns rather than recursing.

Disconnects: `handleDisconnect` marks the player disconnected, freezes the
clock (`paused: true`, timer cleared) if it was their turn, and starts a
`graceMs` timer. Reconnecting within grace (`handleReconnect`) clears that
timer and grants a **fresh** full decision clock rather than resuming a
partial one — sub-second remaining-time tracking across a pause isn't worth
the complexity and is indistinguishable to the player. If grace expires
first, it's treated exactly like a clock timeout at that seat.

A room outlives its match by `ROOM_LINGER_MS` (60s) after `finishMatch` —
`join`ing a room in that window (a client reconnecting late, or a spectator
arriving just after `end`) gets the final `state` plus a resend of the `end`
message (`MatchRoom` keeps the last `MatchResult` around for exactly this).
After the linger the room is dropped from the registry entirely and a
`join` gets `err no_match`; the match itself is still in the database.

## Insights

`/api/users/:name/insights` is the one route on the server that derives its
answer from the hand histories instead of reading a counter the write path
kept. Every hand the player was dealt into is replayed through
`@opentable/engine` (`src/insights.ts`), which is what gives each logged
action the street it was taken on, each seat its total commitment and the
hand its outcome. Nothing re-implements the betting rules: a change to them
lands here for free rather than leaving a second, quietly wrong model of
poker in the server.

The stored log is in table seats and the engine speaks engine seats, so
`liveSeats` is applied on the way in exactly as `handRunner` applies it on
the way out. A hand the player was not dealt into (they had already busted,
which in six-max is most of the rows a match contributes) drops out at that
step, and so does a log that no longer replays, rather than being counted as
a hand with nothing in it.

Two rules shape the payload:

- **Below `MIN_INSIGHT_HANDS` (20) every derived group is null** and only
  `sample` is filled in. Twelve hands of poker say nothing about anybody, and
  a number on the screen is a claim.
- **A rate with no denominator is null, not zero.** No flops seen is not a
  0% showdown rate; never having been the preflop raiser is not a 0% c-bet.
  The client prints what was missing instead.

The answer is memoised per (user, mode) on the id of that player's latest
finished match in that mode: nothing in it can move until another of their
matches ends. The cheap query is the one that produces the key, so a cache
hit costs a single lookup and a new match invalidates without a timer. That
is a server-side memo, not an HTTP cache: the response still carries
`Cache-Control: no-store` like everything else under `/api` (see below).

`getInsightHandsForUser` is bounded (`INSIGHT_HAND_LIMIT`, 3000 hands, newest
first) because this runs on a request path. Three thousand hands replay in
about half a second, which is a cache miss nobody notices and a hot loop
nobody should write.

## No caching on /api
An `onSend` hook in `buildApp` puts `Cache-Control: no-store` on every
response whose path starts with `/api/`. Fastify sends no cache headers of
its own, and a browser is free to apply heuristic freshness to a plain 200
with no validators, which is enough for a client refetching `/api/me` the
instant `end` arrives to be handed its own pre-match copy. Everything under
`/api` is session-scoped and changes the moment a match ends, so none of it
should ever be reused. Static assets are untouched: the static plugin sets
its own headers.

## Building for production
`npm run build -w server` is `tsc -p tsconfig.json` (type-check only — the
tsconfig is `noEmit: true`) followed by `node build.mjs`. The `@opentable/*`
workspace packages ship no compiled JS of their own — their `package.json`
`exports` point straight at `./src/index.ts`, which is fine for `tsx` in dev
but which plain `node` can neither execute nor usefully resolve. `build.mjs`
uses `esbuild` to bundle `src/index.ts` together with every `@opentable/*`
package it imports into one `dist/index.js`; real npm dependencies (fastify,
postgres, ws, …) stay external and resolve from `node_modules` normally at
runtime. `npm start` / the `opentable` systemd unit then just runs
`node dist/index.js`.

`@opentable/preflop`'s chart/equity JSON is a static import (`with { type:
'json' }`), so esbuild inlines both files into `dist/index.js` at bundle
time — nothing needs copying alongside it for the bundle to find them.

## Tests
Real Postgres, no mocks. Run with:

```
npm test -w server
```

### The test database
Tests run against `TEST_DATABASE_URL` from the repo-root `.env`, **not**
`DATABASE_URL`. `src/config.ts` picks it whenever it is running under vitest
(`VITEST` / `NODE_ENV=test`), falling back to `DATABASE_URL` only when
`TEST_DATABASE_URL` is unset, which is a checkout that has not been set up
rather than the intended state. `buildApp()` applies `db/schema.sql` on first
use, so pointing at an empty database is all the setup there is:

```
createdb opentable_test   # then put its URL in .env as TEST_DATABASE_URL
```

This is not hygiene, it is correctness. When the suite ran against the live
database it moved the bots' real ratings (68 stray `rating_history` rows),
left dozens of test guests behind, and — because every `makeApp()` calls
`abortStalePlayingMatches()` — rewrote the flags of a match a real person was
in the middle of playing. Anything that calls `buildApp()` writes to whatever
database `config.databaseUrl` resolved to, so a suite pointed at production
is a suite editing production.

`server/test/helpers.ts` has the shared scaffolding: `makeApp()` builds a
`buildApp()` instance without listening, `mintGuestSession` mints a guest via
`/api/me` and returns its session token, `deleteUser` cleans up,
`connectSession` combines a `Session` with `connectWs` into a `Connected`
(`{id, name, token, ws, messages}`) for tests that juggle several players.

`createMatchForPlayers(userIds, format?)` (`src/matchmaking.ts`) is exported
specifically so tests can create a match directly — skipping the queue/tick
entirely — with any number of seats and a custom `MatchFormat`. Build that
format with `testFormat(overrides)` from `helpers.ts` rather than by hand, so
a new field on `MatchFormat` never has to be added in five files;
`driveRandomPlay(conn)` in the same file plays a seat with uniformly random
legal actions and is what every full-match test drives its clients with.
Tests that need the *real* queue path against a fast format replace
`setFormatResolver` instead, and must put `formatFor` back in `afterAll`.
The challenge path goes through the same resolver, so `challenge.test.ts`
opens its tables on a fast format the same way.

- `match.test.ts` — plays a whole match to `end` with two real clients
  picking uniformly random legal actions from each `state.legal` (a short
  stack relative to the blinds and a small `hands` cap keep this fast — it
  tends to bust in a few hands under random play either way). Checks both
  clients got the same `MatchResult`, ratings/`rating_history` moved
  correctly, the match and every hand row are persisted consistently, and —
  independently, via `replay()` from the stored seed/actions — that the
  stored holes/board/result match what the engine actually produces and that
  each hand's final stacks equal the next hand's `stacks_start` (or the
  match's `final_stacks` for the last one). It also asserts, over every
  frame B ever received while a hand was live, that A's hole cards never
  appeared unmasked — collected via a raw `ws.on('message')` listener kept
  alongside the `WsMessages` queue the driving loop consumes from, since the
  driving loop's own `.wait()` calls only consume frames where it's B's
  turn.
- `authority.test.ts` — a third connection joins as a pure spectator so
  "the state didn't change" can be checked by re-`join`ing it and comparing
  `TableView`s (`toEqual`), independent of whoever's action was rejected.
  Covers wrong turn, stale `h`/`n`, a raise below the minimum, a non-player
  trying to act, and a malformed action kind — noting a spectator's own view
  never has `legal` populated, so getting the acting player's legal bounds
  means asking *their* connection for a fresh view, not the spectator's.
- `sixmax.test.ts` — six in-process clients play a six-max match to
  completion with random legal actions: one player ends with every chip,
  places are a permutation of 1..6, the winner's rating went up and the
  sixth's down, all six got a `rating_history` row and a `match_players.place`,
  the six-max rating row moved while the heads-up one stayed at a fresh
  1500/350/0 (and `match.test.ts` asserts the same in reverse),
  every hand rehashes and replays through its stored `live_seats` mapping,
  every hand's `stats`/`study` are null, and nobody ever saw another seat's
  hole cards in a live frame. Its second case proves the multiway timeout
  rule: a silent seat at a three-handed table is sat out rather than
  forfeiting, keeps being dealt in (more than three `to: true` actions) and
  the table still finishes on a bust.
- `casual.test.ts` — a casual match leaves both players' rating, rd and
  volatility in that mode's row exactly where they were, writes no
  `rating_history`, echoes before === after in the result, and still
  increments `matches`.
- `bots.test.ts` — a lone human waits out `BOT_FILL_HEADS_UP_MS`, is paired
  with a bot and plays the match out, with no bot action ever carrying
  `to: true`; then queues six-max, waits out `BOT_FILL_SIX_MAX_MS` and gets a
  table of five bots that runs down to a single winner. It replaces
  `setFormatResolver` so the real queue path runs on a short clock, which
  also caps how long the bots think.
- `strategy.test.ts` — pure, no database: 400 synthetic views across streets,
  seat counts and stack sizes, asserting every returned action is in that
  view's legal set with an in-range integer amount, plus the specific
  behaviours (raise the best hand, fold the worst to a three-bet, bet a
  monster, fold air to a big bet, call a token bet on the odds, jam short).
- `home-game.test.ts` — the lobby end to end against the real database, shaped
  like `challenge.test.ts` and on the same fast format: creating seats the
  host, joining pushes a `lobby` message to everyone already sitting there and
  is idempotent, the host cannot leave their own table, a start by anyone but
  the host is refused, a start with two humans opens a six-seat match with four
  bots in it and sends both humans `q found`, a start with one human is forced
  casual with a reason, the sixth seat is the last one, cancelling and expiring
  both spend the table, and the fourth open lobby is refused until one is
  cancelled.
- `leaderboard.test.ts` — the board reads the `ratings` table, hides
  provisional players, and a six-max standing never shows on the heads-up
  board.
- `clock.test.ts` — uses `createMatchForPlayers` with a short `clockMs`
  (300ms) so waiting out a real timeout is fast, and (for the check-fold and
  reconnect cases) `hands: 1` so the match finishes the instant that one
  hand does, leaving no dangling `HAND_HOLD_MS` timer that could try to
  `insertHand` for a next hand against a match row the test has already
  deleted. Covers: an unresponsive button/SB gets folded on timeout with
  `to: true` in the persisted action; a disconnect mid-decision shows
  `clock.paused: true` and `connected: false` to the opponent, and
  reconnecting inside `graceMs` resumes with a fresh clock; three
  consecutive timeouts by the same player forfeit the match (engineered by
  seating the timing-out player at BB behind an opponent who only ever
  checks/calls, so action reaches them — and only them — on every street
  without the hand ever resolving in between).

Websocket tests **do not** use `@fastify/websocket`'s `app.injectWS()`
helper — it hardcodes an empty leftover buffer after matching the HTTP 101
response line, so any data the server writes in the same tick as the
upgrade (like our `hi`, sent immediately on connect) is silently dropped.
Real sockets don't have this bug, so `listenForWs(app)` binds an ephemeral
port and tests connect with a real `ws` client instead
(`test/helpers.ts`'s `connectWs`).

That in turn means `hi` can arrive before an `await`-based caller gets a
chance to attach a `'message'` listener, even on a real loopback socket (the
101 response and the immediately-following `hi` frame often parse together
in one read). `connectWs` returns `{ ws, messages }` where `messages` is a
small queue (`WsMessages`) that starts buffering from the moment the socket
is constructed — well before `'open'` — so `messages.wait(predicate)` never
misses something sent early.

Every test file deletes the rows it creates in `afterAll`.
