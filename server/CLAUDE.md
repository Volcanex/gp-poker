# server

Fastify REST + WebSocket + `postgres` driver for EveryonePoker. Owns sessions,
matchmaking, match orchestration, clocks, persistence, and serving
`client/dist`. See the repo root `CLAUDE.md` for the product and the decisions
that span both halves of it.

## Run, build, test
- `npm run dev` from the repo root starts this with `tsx` and serves the built
  client on the same port. `src/index.ts` is thin: build, start matchmaking,
  listen, graceful shutdown.
- `npm run build -w server` is `tsc -p tsconfig.json` (type-check only, the
  tsconfig is `noEmit`) followed by `node build.mjs`.
- `npm test -w server` runs the suite against a real Postgres. **Read
  `test/CLAUDE.md` before running it**: it must point at `TEST_DATABASE_URL`,
  and a suite pointed at production is a suite editing production.

### Why there is a bundle step
The `@opentable/*` workspace packages ship no compiled JS of their own. Their
`package.json` `exports` point straight at `./src/index.ts`, which is fine for
`tsx` in dev but which plain `node` can neither execute nor usefully resolve.
`build.mjs` uses esbuild to bundle `src/index.ts` together with every
`@opentable/*` package it imports into one `dist/index.js`; real npm
dependencies (fastify, postgres, ws) stay external and resolve from
`node_modules` normally at runtime. `npm start` and the `opentable` systemd unit
then just run `node dist/index.js`.

`@opentable/preflop`'s chart and equity JSON is a static import
(`with { type: 'json' }`), so esbuild inlines both files into `dist/index.js` at
bundle time. Nothing needs copying alongside it for the bundle to find them.

## Where things are
| Directory | What, and its own doc |
| --- | --- |
| `src/` | the modules, and the subsystems that live in one file each: auth, the queue, arenas, the ladder, the shared links, insights, the match review, the explorer, link previews |
| `src/match/` | one live match: the room, the hand runner, the seam between them, and how a result becomes a rating |
| `src/ws/` | the connection registry and the message router, including bots' virtual connections |
| `src/bots/` | the bot population (names, personas, schedules), the scheduler that queues them, one bot's message loop and the pure decision function |
| `src/tournaments/` | the fixture calendar, the draw and the scheduler that runs a field down to a final |
| `test/` | the suite, the test database rule and the seams it drives |
| `db/schema.sql` | applied idempotently at start by `applySchema()`; `db/CLAUDE.md` for the numbered-migration exception |

## Four invariants

**The rated flag has one source.** `format.rated` is the only thing that decides
whether a match is rated. `matches.rated` is a copy: written from the format at
insert, and re-asserted from it in `db.finishMatch`, so the column cannot end up
disagreeing with the format it was copied from. `MatchRoom` reads `this.rated`, a
getter over `match.format.rated`, for the rating write and for the `end` message,
never the column.

This is not hypothetical tidiness. A match played on the live server came out of
it with `rated = false` in the row while its format said true and its ratings had
been written and persisted: a test run pointed at the live database had called
`abortStalePlayingMatches()` mid-match, which used to set `rated = false`, and the
live server's own finish never wrote the column back. Two changes came out of
that: the boot abort no longer touches `rated`, and the finish re-asserts it.

**Live matches do not survive a restart.** There is no way to safely resume live
in-memory hand state across a process restart: the queue, every `MatchRoom` and
every hand runner's `HandState` live only in memory. `db.abortStalePlayingMatches()`
runs once at the start of `buildApp()`, before anything else touches the match
tables, and marks any match still `status = 'playing'` from a previous process as
`'aborted'` with `reason: 'abort'`, no rating change and no `rating_history` row.
It does **not** touch `rated`: that column means "this match's format was rated",
and `status` and `reason` plus the absence of a `ratings` payload are what say
whether a rating was actually written. Whoever was mid-match just sees the match
gone. There is no wire message for this, since by definition it only happens to
matches nobody is connected to: the process that would have broadcast it just
died.

**Nothing under `/api` may be cached.** An `onSend` hook in `buildApp` puts
`Cache-Control: no-store` on every response whose path starts with `/api/`.
Fastify sends no cache headers of its own, and a browser is free to apply
heuristic freshness to a plain 200 with no validators, which is enough for a
client refetching `/api/me` the instant `end` arrives to be handed its own
pre-match copy. Everything under `/api` is session-scoped and changes the moment a
match ends. `/api/explorer` is the one deliberate exception, being the same public
aggregate for everybody. Static assets are untouched: the static plugin sets its
own headers.

**Table seats and engine seats are different numberings.** Table seats are
0..N-1 and fixed for the match, and they are what the wire, the database and
`MatchRoom` all speak. The engine is only handed the seats that still have chips.
The hand runner owns the translation and stores the map on the hand row as
`live_seats`; anything reading a stored hand needs it. See `src/match/CLAUDE.md`.

## Schema changes are additive
`db/schema.sql` is applied idempotently on every boot, so every column and table
added since v1 went in additively and re-applies harmlessly: `users.bot`,
`matches.places`, `match_players.place`, `hands.live_seats`,
`rating_history.mode`, the `ratings` table, the three `tournaments` tables, and
the g-admin fields on `tickets` (`scope`, `kind`, `severity`, `edits`,
`replies`, `baked_by`, `updated_at`, `source`). `packages/protocol` is the wire
contract and `PROTOCOL_VERSION` is bumped on change; read the current number off
that constant. `db/CLAUDE.md` covers the one exception: a change reversible
enough to also get a numbered, manually-runnable migration pair.
