# server

Fastify REST + WebSocket + `postgres` driver for Open Table. Owns sessions,
matchmaking, match orchestration, clocks, persistence, and serving
`client/dist`. See the repo root CLAUDE.md for the overall shape and
decisions; this file covers what's not obvious from the code.

## Structure
- `src/config.ts` — env from the repo-root `.env` via `process.loadEnvFile`
  (no dotenv dependency). `DATABASE_URL` and `SESSION_SECRET` are required;
  `PORT`/`HOST` default to 8130/127.0.0.1.
- `src/db.ts` — the `postgres` client (camelCase column transform both ways
  via `postgres.camel`) and every typed query the rest of the server uses.
  `applySchema()` applies `db/schema.sql` idempotently inside a transaction
  holding a `pg_advisory_xact_lock`, so concurrent boots (parallel test
  workers, a rolling deploy) don't race on `create extension if not exists`
  and friends — Postgres's own IF NOT EXISTS isn't safe under concurrency.
  `sql.json()` needs a value typed with an index signature; the `jsonb()`
  helper is the one cast boundary for that mismatch, since named interfaces
  like `MatchFormat` don't have one even though they're plain JSON.
- `src/auth.ts` — guest minting, scrypt password hashing, session cookies.
- `src/userView.ts` — `UserRow` → wire `UserSummary`. `isProvisional`
  delegates to `@opentable/rating`'s own threshold rather than keeping a
  second constant that could drift from it (the leaderboard SQL's
  `rd <= 110` is the one unavoidable duplicate, since SQL can't call into
  the package — commented at the query).
- `src/routes.ts` — all REST endpoints.
- `src/matchmaking.ts` — the in-memory queue and its tick.
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
- `src/index.ts` — thin: build, start matchmaking, listen, graceful shutdown.
- `build.mjs` — the production build (see "Building for production" below).

## Auth model
A guest is minted on any request that lacks a valid `ot_session` cookie
(`auth.requireUser`, used by `/api/me` and anything else that should always
have a "current user"). The cookie is httpOnly, `SameSite=Lax`, 90 days, and
`secure` when `X-Forwarded-Proto: https` (nginx terminates TLS) or the
request itself is https. Guest names are `guest-` + 4 random base32-ish
chars, retried on the (rare) unique collision. Claiming sets `name` and
`password_hash` on the *same* row (`guard: guest = true`), so rating and
history carry over. Password hashing is `crypto.scrypt`, stored as
`salt:hash` hex. The websocket path uses `resolveSessionUser` instead — it
does **not** mint a guest; `/ws`'s `preValidation` hook rejects the upgrade
with 401 if there's no valid session, since the client always calls
`/api/me` first to get one.

## Matchmaking tick
`src/matchmaking.ts` keeps an in-memory `Map<userId, QueueEntry>` — nothing
here is persisted, so a server restart drops the queue (acceptable: clients
just re-send `queue`). `enqueue` widens the user's RD for inactivity via
`@opentable/rating`'s `widenRd` before adding them, and immediately replies
`q searching`. A 1s `setInterval` (`tick`, exported so tests can call it
directly instead of waiting on the real timer) calls `pairQueue` and, for
each pair returned, creates the match: allocates a short id (base32-ish,
retried on the rare collision), inserts `matches`/`match_players`, builds a
`MatchRoom`, registers it, and sends `q found` to both sockets. Every
un-paired entry gets a fresh `q searching` each tick with its current
`window()` range.

## HandRunner seam
`MatchRoom` (in `src/match/room.ts`) owns orchestration only — subscribers,
the wall clock, disconnect grace, persistence, rating writeback on finish —
and never touches a `HandState` directly. It talks to hand state only
through the `HandRunner` interface (`src/match/types.ts`):

```ts
interface HandRunner {
  startHand(number: number): Promise<void>;
  onAction(userId: string, msg: Extract<ClientMsg, { t: 'act' }>): boolean; // false = rejected, err already sent
  onTimeout(seat: number): void; // apply check-if-legal-else-fold, log with to: true
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
`@opentable/engine`. Per match it tracks the two seats' running stacks
across hands, the current `HandState`, and a `MatchOutcome | null` that's
non-null once the whole match (not just a hand) is decided. Notable pieces:

- **startHand** allocates a fresh `newSeed()`, computes `button = (number -
  1) % 2` (hand 1 = seat 0), and `insertHand`s the row — seed hash, button,
  starting stacks — *before* calling `createHand`, so the commitment exists
  before any card is dealt even if the process dies immediately after. If
  both stacks are covered by the blinds alone, `createHand` itself resolves
  straight to `'done'` (see engine's CLAUDE.md); `startHand` handles that by
  immediately kicking off hand completion rather than assuming there's
  something to act on.
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
  becomes `'done'`): persists the hand row (seed, actions, board, holes,
  `result`, `stats` from `preflop.handStats`, `study` — per seat,
  `preflop.extractDecisions` filtered to that seat plus `summarise()` of
  them — and `completedAt`), updates the running stacks from
  `state.seats[].stack`, bumps `hands_played`. If a stack hit 0 or
  `hands_played` reached `format.hands`, calls `finishNaturally` and reports
  `isDone()`/`matchResult()`. Otherwise it waits `HAND_HOLD_MS` (a plain
  module constant, currently 4s — long enough for the reveal to actually
  register) and then calls `startHand` for the next number.
- **onChange callback**: `MatchRoom.start()` hands the hand runner a closure
  that does `broadcast(); rearmClock(); settleIfDone()`. The room calls those
  itself right after any *synchronous* `onAction`/`onTimeout`, but starting
  the next hand or finishing the match both happen *after* the `HAND_HOLD_MS`
  wait or an async rating fetch — `onChange()` is what tells the room to
  react to those without giving the hand runner a reference to the room.

`MatchOutcome` (`src/match/types.ts`) is deliberately richer than the wire
`MatchResult`: it carries each player's post-match `volatility`, which
Glicko-2 needs internally but which the protocol never puts on the wire.
`finishMatch` projects it down to `MatchResult` for the `end` broadcast and
passes the full thing to `db.finishMatch` for persistence.

## End conditions and rating
Three ways a match ends, all producing a `MatchOutcome`:
- **bust** — a stack hit 0 at hand completion (`EngineHandRunner.
  finishNaturally`).
- **hands** — `hands_played` reached `format.hands`; ties (equal stacks) are
  a draw (`winner: null`).
- **forfeit** — `MatchRoom`'s own per-player consecutive-timeout counter hit
  3 (see "Clock design" below); this can fire mid-hand, before the hand
  runner ever reaches `isDone()`, so `MatchRoom.buildForfeitOutcome` computes
  the rating change itself rather than asking the hand runner for one.

Both paths (`finishNaturally` and `buildForfeitOutcome`) go through the same
`computeMatchRatings(a, b, scoreForA)` in `src/match/rating.ts`: widen each
player's RD for their own inactivity (`widenRd`, days since `rating_at`),
then `updateRating` each one against the other's *widened* rating/RD with
score 1/0/0.5. `before`/`rdBefore` in the result are the actual persisted
pre-match values, not the widened ones — widening is an input to the
algorithm, not something that happened to the player's record. Peak rating
updates when the new rating exceeds it (`db.finishMatch`'s SQL, `greatest(
peak_rating, new_rating)`).

## Boot-time abort
There's no way to safely resume live in-memory hand state across a process
restart — the queue, every `MatchRoom`, and every `HandRunner`'s `HandState`
live only in memory. `db.abortStalePlayingMatches()` runs once at the start
of `buildApp()`, before anything else touches the match tables: any match
still `status = 'playing'` from a previous process is marked `'aborted'`,
`reason: 'abort'`, `rated: false` — no rating change, no `rating_history`
row. Whoever was mid-match just sees the match gone; there's currently no
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
the opponent (`forfeit`).

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

One consequence of bundling: `@opentable/preflop`'s chart/equity JSON is
loaded relative to its own source file's location at runtime
(`import.meta.url` in `packages/preflop/src/data.ts`). Once everything is
one file at `server/dist/index.js`, that same relative path resolves to
`server/data/` instead of `packages/preflop/data/` — `build.mjs` copies the
JSON there as its last step. `server/data/` is gitignored (generated), same
as `server/dist/`.

## Tests
Real Postgres from the repo-root `.env` (no mocks) — `docker compose up -d
db` if there's none locally. Run with:

```
npm test -w server
```

`server/test/helpers.ts` has the shared scaffolding: `makeApp()` builds a
`buildApp()` instance without listening, `mintGuestSession` mints a guest via
`/api/me` and returns its session token, `deleteUser` cleans up,
`connectSession` combines a `Session` with `connectWs` into a `Connected`
(`{id, name, token, ws, messages}`) for tests that juggle several players.

`createMatchForPlayers(userIdA, userIdB, format?)` (`src/matchmaking.ts`) is
exported specifically so tests can create a match directly — skipping the
queue/tick entirely — with a custom `MatchFormat` (short `clockMs`/`graceMs`,
a small `hands` count, whatever the test needs) instead of `DEFAULT_FORMAT`.
The normal pairing path (`tick`) just calls it with the default.

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
