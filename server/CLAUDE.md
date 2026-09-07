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
- `src/match/room.ts` — `MatchRoom`: subscribers, the decision clock,
  disconnect grace, persistence on finish. Talks to hand state only through
  the `HandRunner` interface (see below).
- `src/match/rooms.ts` — room registry, by match id and by player id (for
  routing disconnects/reconnects to the right room without scanning all of
  them).
- `src/app.ts` — builds the Fastify instance (routes, cookie/websocket/static
  plugins, `/ws` auth) without listening or starting matchmaking's tick, so
  tests can build it, inject into it, and control timing themselves.
- `src/index.ts` — thin: build, start matchmaking, listen, graceful shutdown.

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

## HandRunner seam (phase two)
`MatchRoom` (in `src/match/room.ts`) owns orchestration only — subscribers,
the wall clock, disconnect grace, persistence, rating writeback on finish —
and never touches a `HandState` directly. It talks to hand state only
through the `HandRunner` interface:

```ts
interface HandRunner {
  startHand(number: number): Promise<void>;
  onAction(userId: string, msg: Extract<ClientMsg, { t: 'act' }>): void;
  onTimeout(seat: number): void; // apply check-if-legal-else-fold, log with to: true
  toActSeat(): number | null;
  isDone(): boolean;
  matchResult(): MatchOutcome | null; // MatchOutcome, not the wire MatchResult — see below
  viewFor(userId: string | null, clock: RoomClock | null): TableView | null;
}
```

`MatchRoom.hand` is `null` in phase one; nothing constructs a `HandRunner`
yet. Phase two's job is to build one (wrapping `@opentable/engine` +
`@opentable/preflop`) and wire `new MatchRoom(match)` up to call
`this.hand.startHand(1)` once both seats are set. Note `viewFor` takes the
room's clock state as a parameter rather than the hand runner tracking
disconnects itself — masking hole cards is the engine's job
(`toView(state, viewerSeat)`), but *whose turn it is on the wall clock* is
an orchestration concern the hand runner shouldn't need to know about.

`MatchOutcome` (also in `room.ts`) is deliberately richer than the wire
`MatchResult`: it carries each player's post-match `volatility`, which
Glicko-2 needs internally but which the protocol never puts on the wire.
`finishMatch` projects it down to `MatchResult` for the `end` broadcast and
passes the full thing to `db.finishMatch` for persistence.

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

## Tests
Real Postgres from the repo-root `.env` (no mocks) — `docker compose up -d
db` if there's none locally. Run with:

```
npm test -w server
```

`server/test/helpers.ts` has the shared scaffolding: `makeApp()` builds a
`buildApp()` instance without listening, `mintGuestSession` mints a guest via
`/api/me` and returns its session token, `deleteUser` cleans up.

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
