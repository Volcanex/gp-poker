# test

Real Postgres, no mocks. `npm test -w server`.

## The test database

Tests run against `TEST_DATABASE_URL` from the repo-root `.env`, **not**
`DATABASE_URL`. `../src/config.ts` picks it whenever it is running under vitest
(`VITEST` or `NODE_ENV=test`), falling back to `DATABASE_URL` only when
`TEST_DATABASE_URL` is unset, which is a checkout that has not been set up rather
than the intended state. `buildApp()` applies `../db/schema.sql` on first use, so
pointing at an empty database is all the setup there is:

```
createdb opentable_test   # then put its URL in .env as TEST_DATABASE_URL
```

**This is not hygiene, it is correctness.** When the suite ran against the live
database it moved the bots' real ratings (68 stray `rating_history` rows), left
dozens of test guests behind, and, because every `makeApp()` calls
`abortStalePlayingMatches()`, rewrote the flags of a match a real person was in
the middle of playing. Anything that calls `buildApp()` writes to whatever
database `config.databaseUrl` resolved to, so a suite pointed at production is a
suite editing production.

## Files run one at a time

`../vitest.config.ts` sets `fileParallelism: false`. Every file here boots the
app against the one test database, and a boot aborts whatever matches another
file left playing, so two files running at once would abort each other's
matches. Tests inside a file still share nothing they did not set up, and every
file deletes the rows it creates in `afterAll`.

## Scaffolding and seams

`helpers.ts` holds the shared kit. `makeApp()` builds a `buildApp()` instance
without listening. `mintGuestSession` mints a guest via `/api/me` and returns its
session token. `deleteUser` cleans up. `connectSession` combines a `Session` with
`connectWs` into a `Connected` (`{id, name, token, ws, messages}`) for tests that
juggle several players. `driveRandomPlay(conn)` plays a seat with uniformly
random legal actions and is what every full-match test drives its clients with.

The production code carries four seams, all in the same spirit: a test drives
the real path rather than a parallel one.

| Seam | Where | For |
| --- | --- | --- |
| `createMatchForPlayers(userIds, format?)` | `../src/matchmaking.ts` | build a match directly, skipping the queue and the tick, with any number of seats and a custom `MatchFormat` |
| `setFormatResolver` | `../src/matchmaking.ts` | swap `formatFor` so the **real** queue path runs against a short clock and a small stack. Put `formatFor` back in `afterAll` |
| `tick`, `ladderTick`, `arenaTick` | matchmaking, ladder, arena | run one pass directly instead of waiting on a real timer |
| `configureArena` | `../src/arena.ts` | wider than the others because an arena has a clock: `now`, `format`, `everyMs`, `durationMs`, `botFillMs` and `lastPairingBeforeEndMs` are all injectable |
| `configureFriends` | `../src/friends.ts` | the presence debounce, so a test does not wait five real seconds to watch somebody go offline. `resetFriendPresence()` is its cleanup, like `resetReadyChecks()` |

Two more in `helpers.ts` for the two doors a queued table now has to get
through:

- **`unlockRanked(userId)`** writes the one finished unrated match the ranked
  gate asks for, rather than driving a whole table through the engine to
  produce it. Anything that queues rated needs it, and the match id comes back
  for the caller's own cleanup.
- **`acceptReady(conn)`** waits for the ready prompt and accepts it, which is
  what every seat at a matchmade table now has to do before `q found` arrives.
  Practice, challenges and home games need none of it.

Build a format with `testFormat(overrides)` from `helpers.ts` rather than by
hand, so a new field on `MatchFormat` never has to be added in five files. The
challenge and home game paths go through the same resolver, so their tests open
tables on a fast format the same way.

The ladder and the arena are off under vitest by default (`config.ladderEnabled`,
`config.arenaEnabled`) unless a test asks for them.

**The ready check has no off switch, on purpose.** It is on the real path to
every matchmade table, and a seam that let most of the suite skip it would mean
most of the suite testing a path production does not run. `resetReadyChecks()`
from `../src/ready.ts` is the cleanup instead: pending checks and cooldowns are
process state, and a file that left either behind would fail the next one
rather than its own. Call it in `afterAll` anywhere a check is opened.

`ready.test.ts` drives the state machine with made-up ids and no sockets at
all: the hub drops a send to a user with no connection, so what a check does,
which way it settles and who it charges, is readable straight off the two
callbacks the caller hands it. `speed.test.ts` is pure arithmetic and touches
neither the app nor the database.

## Two websocket gotchas

**Do not use `@fastify/websocket`'s `app.injectWS()` helper.** It hardcodes an
empty leftover buffer after matching the HTTP 101 response line, so any data the
server writes in the same tick as the upgrade (like our `hi`, sent immediately on
connect) is silently dropped. Real sockets do not have this bug, so
`listenForWs(app)` binds an ephemeral port and tests connect with a real `ws`
client instead (`connectWs`).

That in turn means `hi` can arrive before an `await`-based caller gets a chance
to attach a `'message'` listener, even on a real loopback socket: the 101
response and the immediately-following `hi` frame often parse together in one
read. `connectWs` returns `{ ws, messages }` where `messages` is a small queue
(`WsMessages`) that starts buffering from the moment the socket is constructed,
well before `'open'`, so `messages.wait(predicate)` never misses something sent
early.

## What each file covers

The full-match files are the ones with the most to say about how they are built:

- `match.test.ts` plays a whole heads-up match to `end` with two real clients
  picking uniformly random legal actions (a short stack relative to the blinds
  and a small `hands` cap keep it fast). It checks both clients got the same
  `MatchResult`, that ratings and `rating_history` moved correctly, that the
  match and every hand row are persisted consistently, and, independently via
  `replay()` from the stored seed and actions, that the stored holes, board and
  result match what the engine actually produces and that each hand's final
  stacks equal the next hand's `stacks_start` (or the match's `final_stacks` for
  the last one). It also asserts, over every frame B ever received while a hand
  was live, that A's hole cards never appeared unmasked. That is collected via a
  raw `ws.on('message')` listener kept alongside the `WsMessages` queue the
  driving loop consumes from, since the driving loop's own `.wait()` calls only
  consume frames where it is B's turn.
- `sixmax.test.ts` runs six in-process clients to completion: one player ends
  with every chip, places are a permutation of 1..6, the winner's rating went up
  and the sixth's down, all six got a `rating_history` row and a
  `match_players.place`, the six-max rating row moved while the heads-up one
  stayed at a fresh 1500/350/0 (and `match.test.ts` asserts the same in reverse),
  every hand rehashes and replays through its stored `live_seats` mapping, every
  hand's `stats` and `study` are null, and nobody ever saw another seat's hole
  cards in a live frame. Its second case proves the multiway timeout rule: a
  silent seat at a three-handed table is sat out rather than forfeiting, keeps
  being dealt in (more than three `to: true` actions) and the table still
  finishes on a bust.
- `authority.test.ts` has a third connection join as a pure spectator so "the
  state did not change" can be checked by re-`join`ing it and comparing
  `TableView`s with `toEqual`, independent of whoever's action was rejected. It
  covers wrong turn, stale `h`/`n`, a raise below the minimum, a non-player
  trying to act, and a malformed action kind. Note a spectator's own view never
  has `legal` populated, so getting the acting player's legal bounds means asking
  **their** connection for a fresh view, not the spectator's.
- `clock.test.ts` uses `createMatchForPlayers` with a 300ms `clockMs` so waiting
  out a real timeout is fast, and (for the check-fold and reconnect cases)
  `hands: 1` so the match finishes the instant that one hand does, leaving no
  dangling hand-hold timer that could try to `insertHand` against a match row the
  test has already deleted. The three-consecutive-timeouts forfeit is engineered
  by seating the timing-out player at BB behind an opponent who only ever checks
  or calls, so action reaches them, and only them, on every street without the
  hand ever resolving in between.
- `sitout.test.ts` is the other half of the multiway timeout rule, and the
  reason it needed one: three timeouts sit a seat out, the wire says so, and a
  sat-out seat whose player is **still connected** takes the ordinary full
  clock rather than being folded at nought milliseconds. Its own helper builds
  a three-handed table where seat 0 watches and never acts, and every test that
  carries on from there `drain`s that connection first, because `WsMessages`
  matches the backlog before it waits and a clock assertion would otherwise be
  made against a deadline that ran out three hands ago. The predicate for "it
  is their turn" asks the engine (`seat.acting`) as well as the clock, since
  the broadcast that reports a timeout still carries the deadline that has just
  expired on the seat it expired on. Its last case is the practice table: the
  human is away for ten grace windows and the hand does not move, which is what
  says no forfeit, no sit-out and no grace expiry there.
- `casual.test.ts` checks a casual match leaves both players' rating, rd and
  volatility in that mode's row exactly where they were, writes no
  `rating_history`, echoes before === after in the result, and still increments
  `matches`.
- `bots.test.ts` waits a lone human out `BOT_FILL_HEADS_UP_MS`, pairs them with a
  bot and plays the match out with no bot action ever carrying `to: true`; then
  queues six-max, waits out `BOT_FILL_SIX_MAX_MS` and gets a table of five bots
  that runs down to a single winner. It replaces `setFormatResolver` so the real
  queue path runs on a short clock, which also caps how long the bots think.
- `home-game.test.ts` covers the lobby end to end, shaped like
  `challenge.test.ts` and on the same fast format: creating seats the host,
  joining pushes a `lobby` message to everyone already sitting there and is
  idempotent, the host cannot leave their own table, a start by anyone but the
  host is refused, a start with two humans opens a six-seat match with four bots
  in it and sends both humans `q found`, a start with one human is forced casual
  with a reason, the sixth seat is the last one, cancelling and expiring both
  spend the table, and the fourth open lobby is refused until one is cancelled.

The rest each cover one surface and read as their names suggest:
`arena.test.ts` (an arena opening, pairing, scoring and closing through
`configureArena`), `auth.test.ts`, `avatar.test.ts` (a webp and a png in and
back out byte for byte, a gif refused on its magic number whatever its header
says, an oversized body refused by the route's own limit, the ten second gap,
removal bumping the version, the cache header with and without `?v=`, and the
version reaching a seat at the table), `challenge.test.ts`, `chat.test.ts`,
`explorer.test.ts`, `feed.test.ts`, `friends.test.ts` (the request, accept,
decline, cancel and unfriend state machine, the guest and bot refusals, both
caps, presence and the table a friend is at, the pushes to both parties, and an
invite's link and the speed it deals), `health.test.ts`, `identity.test.ts`,
`insights.test.ts`, `ladder.test.ts`, `leaderboard.test.ts` (the board reads the
`ratings` table, hides provisional players, and a six-max standing never shows on
the heads-up board), `matchmaking.test.ts`, `meta.test.ts`, `practice.test.ts`,
`puzzle.test.ts`, `spa.test.ts`, `spectate.test.ts` and `ws.test.ts`.

`strategy.test.ts` is the odd one out: pure, no database. It drives 400 synthetic
views across streets, seat counts and stack sizes, asserting every returned
action is in that view's legal set with an in-range integer amount, plus the
specific behaviours (raise the best hand, fold the worst to a three-bet, bet a
monster, fold air to a big bet, call a token bet on the odds, jam short). The bot
levels have their own test next to the code they order, in
`../src/bots/levels.test.ts`.
