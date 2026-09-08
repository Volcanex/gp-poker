# match

One live match: the room that orchestrates it, the hand runner that plays it,
and how a finished one becomes a rating.

- `types.ts`: `RoomClock`, `HandRunner`, `MatchOutcome`. The seam itself, in its
  own file so `room.ts` and `handRunner.ts` can both import it without importing
  each other.
- `room.ts`: `MatchRoom`. Subscribers, the decision clock, disconnect grace,
  chat, persistence and rating writeback on finish. It talks to hand state only
  through `HandRunner` and constructs the concrete `EngineHandRunner` itself in
  `start()`.
- `handRunner.ts`: `EngineHandRunner`, the implementation over a live
  `@opentable/engine` `HandState`, plus `@opentable/preflop` scoring on hand
  completion.
- `rating.ts`: `computeMatchRatings`, the one place a finished match becomes a
  rating change.
- `rooms.ts`: the registry, by match id and by player id, so a disconnect or a
  reconnect routes to the right room without scanning all of them.
- `finished.ts`: a listener registry a room emits to at the end of
  `finishMatch`.

## Table seats and engine seats

Table seats are 0..N-1 and fixed for the whole match. They are what the wire, the
database and `MatchRoom` all speak. The engine is only ever handed the seats that
still have chips, so its `HandConfig` indexes are a different, shorter numbering
that changes every hand.

`EngineHandRunner` owns the map (`liveSeats[engineSeat] = tableSeat`) and
translates everything crossing the boundary: actions in, views out, and the
stored action log, holes and hand result, all of which are persisted in TABLE
seats. **Every seat number on the hand runner's public surface is a table seat.**
The mapping itself is stored on the hand row as `live_seats`, which is what lets
a replay rebuild the same `HandConfig`:

```
config.seats  = live_seats.map(t => ({ id: seats[t].user_id, stack: stacks_start[t] }))
config.button = live_seats.indexOf(hands.button)   // hands.button is a table seat
actions       = stored.map(a => ({ ...a, s: live_seats.indexOf(a.s) }))
```

Heads-up `live_seats` is always `[0, 1]` (a bust ends the match), so the two
numberings coincide and nothing about existing matches changes. The button starts
on the lowest live seat and moves to the next live seat each hand, skipping
anyone who has busted. An eliminated player keeps their seat in the view with
`out: true` and their `place`.

Preflop `study` and `stats` are heads-up only. `@opentable/preflop`'s charts and
spot walker model two players, so a six-max hand stores null for both rather than
a wrong number, and the profile aggregates already skip hands with null stats.

## The HandRunner seam

`MatchRoom` owns orchestration only and never touches a `HandState` directly. Two
choices in `types.ts` are worth knowing about rather than reading past:

- **`onAction` returns a boolean**, not void. `MatchRoom.handleAct` only
  rebroadcasts and rearms the clock when something actually changed, otherwise a
  client spamming illegal actions could keep resetting their own clock for free.
- **`viewFor` takes the room's clock and per-seat connectivity as parameters**
  rather than the hand runner tracking either itself. Masking hole cards is the
  engine's job (`visibleCards(state, viewerSeat)`), but whose turn it is on the
  wall clock and who is currently connected are orchestration concerns the hand
  runner should not need to know about.

`isDone()` is true once the whole MATCH is decided, not just the current hand.

## Inside EngineHandRunner

Per match it tracks every table seat's running stack and `place`, the live-seat
map for the current hand, the current `HandState`, and a `MatchOutcome | null`
that is non-null once the whole match is decided.

- **startHand** collects the seats that still have chips, moves the button to the
  next live one (hand 1 puts it on the lowest live seat, which heads-up
  reproduces the old `(number - 1) % 2` rotation), reads the level from
  `levelAt(format, number, elapsed)` and its blinds from `blindsAt` with the same
  elapsed time, allocates a fresh `newSeed()`, and `insertHand`s the
  row (seed hash, button, starting stacks for all N seats, `live_seats`, **and the
  blinds it settled on**) **before**
  calling `createHand`, so the commitment exists before any card is dealt even if
  the process dies immediately after. If everyone left is covered by the blinds
  alone, `createHand` itself resolves straight to `'done'` (see
  `packages/engine/CLAUDE.md`); `startHand` handles that by immediately kicking
  off hand completion rather than assuming there is something to act on.
- **onAction** validates in the order the wire error codes imply. Not this seat's
  turn gives `err not_your_turn`; `msg.h` or `msg.n` mismatching the current hand
  or seq gives `err stale`; otherwise it hands off to `apply()`, which throws
  `IllegalAction` for anything else wrong (bad amount, wrong action for the spot,
  a garbage action kind that is not in `legal().actions`) and yields `err
  illegal`. There is no separate malformed-message branch: a missing or
  wrong-typed `h`, `n` or `a` falls through the same checks and lands on `stale`
  or `illegal`, which is precise enough. On success it stamps the logged action's
  `t` (ms since hand start, the engine always writes `0`) and classifies what
  happened for `TableView.last`.
- **onTimeout** applies `'x'` if legal for that seat, else `'f'`, stamping
  `to: true` on the logged action.
- **`TableView.last` classification**, in priority order after any transition:
  the hand just resolved (`prev.street !== 'done' && next.street === 'done'`)
  gives `'showdown'` if anyone's cards were revealed (`result.shown` non-empty)
  else `'award'`; the board grew gives `'street'` with the newly-revealed cards;
  else `'timeout'` if the transition came from `onTimeout`, else plain `'act'`.
  `startHand` sets `'deal'` for hand 1 and `'newhand'` for every hand after.
- **pot** is `sum(seat.committed)`. The engine's `committed` already accumulates
  across the whole hand including the current street's `bet` (`bet` resets to 0
  each street, `committed` never does), so there is nothing to add on top.
- **Hand completion** (`completeHand`, whenever `state.street` becomes `'done'`)
  persists the hand row, updates the running stacks, bumps `hands_played`, then
  settles with `settleHeadsUp` or `settleMultiway`. If neither ends the match it
  waits `min(HAND_HOLD_MS, format.clockMs)`, 4s in the product, long enough for
  the reveal to register and never longer than the decision clock so a short test
  clock does not spend four seconds on a finished board, and then calls
  `startHand` for the next number. On a practice table this wait is the practice
  hold instead (below), for every hand including the last.
- **onFail callback.** Dealing the next hand and completing one are both detached
  async work, run from a timer or after an action has already returned, with
  nothing left to await their rejection. A failed write there used to become an
  unhandled rejection, which Node 22 ends the process over, taking every other
  live match down with it. Both routes now report to `onFail`, and
  `MatchRoom.abandon` stops the room's timers and unregisters it. Reproduce the
  old behaviour by deleting a `matches` row mid-match: the next `insertHand` hits
  a foreign key violation from inside the hand-hold timer.
- **onChange callback.** `MatchRoom.start()` hands the hand runner a closure that
  does `broadcast(); rearmClock(); settleIfDone()`. The room calls those itself
  right after any synchronous `onAction` or `onTimeout`, but starting the next
  hand and finishing the match both happen after the hand-hold wait or an async
  rating fetch. `onChange()` is what tells the room to react to those without
  giving the hand runner a reference to the room.

`MatchOutcome` is deliberately richer than the wire `MatchResult`: it carries
each player's post-match `volatility`, which Glicko-2 needs internally but which
the protocol never puts on the wire. It also carries `places`, which the wire
does take. `finishMatch` projects it down to `MatchResult` for the `end`
broadcast and passes the full thing to `db.finishMatch` for persistence.

## End conditions and places

Every way a match ends produces a `MatchOutcome` carrying `places`, one finishing
position per user id, 1 = best.

- **bust, heads-up**: a stack hit 0 at hand completion. Winner 1, loser 2.
- **hands, heads-up**: `hands_played` reached `format.hands`; equal stacks is a
  draw (`winner: null`, both places 1).
- **bust, six-max**: one player holds every chip. Places are reverse elimination
  order, and everyone knocked out in the same hand shares the block of places
  just below whoever is left, ordered by the stack they **started** that hand
  with, since the bigger stack outlasted the smaller one.
- **forfeit**: heads-up only, `MatchRoom`'s per-player consecutive-timeout
  counter hit 3. It can fire mid-hand, before the hand runner ever reaches
  `isDone()`, so `MatchRoom.buildForfeitOutcome` computes the outcome itself
  rather than asking the hand runner for one.

**Multiway never forfeits.** Handing the rest of the table a free elimination
because one seat went quiet is worse than the alternative. After three timeouts
that player is **sat out** instead: every decision is auto check-folded the
instant it reaches them (no clock burnt), blinds keep being posted, and they play
down to a bust like anyone else. Any `act` message un-sits them, **including one
the room rejects**, because the auto check-fold fires the moment it becomes their
turn and a returning player is always too late to act cleanly.

## One rating period per match

`computeMatchRatings(players, places, rated)` is shared by `finishNaturally` and
`buildForfeitOutcome`. Both feed it the rating rows for **this match's mode** and
nothing else, so a six-max result can never move a heads-up rating.

Every player gets exactly one Glicko-2 period holding a result against every
other seat: 1 if their place is better, 0 if worse, 0.5 if equal. Heads-up that
reduces to the old win/loss/draw update; six seats give each player five results
in the one period, which is what stops a sit-and-go being scored as five separate
matches. Each player's RD is widened for their own inactivity first (`widenRd`,
days since `rating_at`) and every opponent is fed in at their widened rating too.
`before` and `rdBefore` report the actual persisted pre-match values, not the
widened ones: widening is an input to the algorithm, not something that happened
to the player's record. Peak rating updates when the new rating exceeds it, in
`db.finishMatch`'s `greatest(peak_rating, new_rating)`.

A **casual** match (`rated: false`) returns an echo instead: after === before,
rdAfter === rdBefore. `db.finishMatch` then upserts counters only, leaving the
Glicko-2 columns, `rating_at` and the `rating_history` row alone. The
win/loss/draw and `matches` counters still move for every finished match either
way: a casual game was played, it just was not rated. Multiway has no draw, so
first place counts as a win and every other place as a loss.

## Clock design

A fresh `clockMs`-long deadline starts (`rearmClock`) whenever `hand.toActSeat()`
changes to a new non-null seat, tracked in `MatchRoom.clock` (`{ seat, deadline,
paused }`) and armed with a real `setTimeout`. On expiry (`handleClockExpiry`)
the room calls `hand.onTimeout(seat)`, then bumps that player's
consecutive-timeout counter. A sat-out seat is never given a clock: `rearmClock`
queues its auto check-fold on a zero-delay timer instead, so a whole street of
sat-out seats unwinds as separate turns rather than recursing.

Disconnects: `handleDisconnect` marks the player disconnected, freezes the clock
(`paused: true`, timer cleared) if it was their turn, and starts a `graceMs`
timer. Reconnecting within grace (`handleReconnect`) clears that timer and grants
a **fresh** full decision clock rather than resuming a partial one: sub-second
remaining-time tracking across a pause is not worth the complexity and is
indistinguishable to the player. If grace expires first it is treated exactly
like a clock timeout at that seat.

A room outlives its match by `ROOM_LINGER_MS` (60s) after `finishMatch`. A `join`
in that window (a client reconnecting late, or a spectator arriving just after
`end`) gets the final `state` plus a resend of the `end` message, which is why
`MatchRoom` keeps the last `MatchResult` around. After the linger the room is
dropped from the registry entirely and a `join` gets `err no_match`; the match
itself is still in the database.

## The practice hold

A practice table does not deal the next hand (or send `end`, on the last one)
on the fixed `holdFor` timer every other table uses. Instead
`EngineHandRunner.holdAfterHand` waits for the human to send `{t: 'next', m, h}`
echoing the hand just held, with `practiceHoldTimeoutFor(format)` (120s by
default, `format.practiceHoldTimeoutMs` in a test) as the fallback if they
never do. `next()` on the hand runner ignores anything that is not exactly
that: a stale hand number, a spectator, or a seat that is not the human's.

**`waitingForHuman()` decides whether to wait at all**, and it is not simply
"is this a practice table": it also requires `places[humanSeat] === null`, the
human still being in the hand. Checked *before* `settleHeadsUp`/
`settleMultiway` on the hand that might end the match (so a hand that busts
the human still holds for their `next` before the match is declared over), and
*after* settling on a hand that does not (so a human busted out of a multiway
practice table no longer holds up the bot-only hands that outlive them — there
is nobody left to press the button, and holding for one anyway would need the
120s timeout to fire on every remaining hand). `humanSeat` itself is fixed at
construction, the one seat that is not a bot; a practice table always has
exactly one.

`TableView.hold` is `'you'`, sent only to the human's own view, only while a
hold from this mechanism is in progress. It answers "the table is waiting on
me", not "a hand just ended": every other viewer (the bots, a spectator) sees
the same held board with no `hold` key at all, since only the human can answer
it.

## Spectating

A `join` for a match you have no seat in makes you a spectator. `MatchRoom` keeps
you in the same `subscribers` set the players are in and sends you
`viewFor(userId, ...)` with no seat, which is the existing per-viewer view builder
doing the existing stripping: `you: null`, `legal: null`, every hole card
`['?','?']` until `state.result.shown` reveals it. **There is no second view path
to keep in step**, which is the point. `handleAct` already refuses anybody
without a seat.

The only thing spectators need beyond that is a lifetime. A player's subscription
survives their grace window, a spectator's does not, so `rooms.ts` keeps a
`bySpectator` map and `routeDisconnect` drops every table that user was watching.
Without it the subscriber set only ever grows. `room.spectatorCount` is reported
on `/api/live` and deliberately never sent to the table.

## Table chat

`MatchRoom.handleChat` is the whole of it, over the pure limiter in
`../chat.ts`. **Two channels, one allowance.** A seated player's line goes to
every subscriber; a spectator's goes only to the other spectators, which is what
stops a table being coached from the rail, and is why `ChatFrom.seat` being null
is both "who said it" and "where it lands". A player joining is replayed the
table's channel, a spectator both of them merged back into the order they were
said in.

The two rings are capped separately (`CHAT_HISTORY` each) rather than as one list
of a hundred: a busy rail would otherwise evict the conversation a reconnecting
player came back for.

**The allowance is spent synchronously, before the name lookup is awaited.**
`handleChat` cleans the text, checks the limiter and records the send, and only
then awaits `getUserById` to find out who is speaking. Two messages arriving in
the same tick would otherwise both pass a check made after a database round trip,
and the gap that stops a flood would not exist. Content refusals run before the
limiter, so a rejected link costs nobody one of their twenty.

Bots never chat: nothing in `../bots/` sends one, and `deliverChat` drops a
message from a `users.bot` row rather than repeating it as though a bot had. The
`chat` table is written as it is said and read by nothing: moderation is a tool
still to be built, not a route left open.

## How a result leaves the room

`finished.ts` is a listener registry a room emits to at the end of `finishMatch`,
and it is how the arena scores its matches. A room knows how to play poker and
how to persist a result; it does not know what an arena is, and a table that
imported the scoreboard would have to import the next thing that wants to hear
too. Same injection shape as `setBotDispatch`.

## The blind schedule has two bases

`startHand` measures elapsed match time from `match.createdAt`, not from when
the runner was constructed, so a room rebuilt over an existing match keeps the
clock the match was actually created on rather than restarting the ladder.
`levelAt` takes whichever basis is further along, hands or the clock, which is
what makes a short format (no hand basis at all) climb on time and a standard one
climb on hands with the clock only catching a table that is running long.

**The level the runner settled on is written to the hand row and reported on
`TableView.level`.** Neither is a convenience. A short format's level is a
function of a wall clock, so nothing reading the hand back afterwards, a
replay, the explorer, the insights walk, could recompute it, and the client's
header would print a level the table was not on. See `../CLAUDE.md` for
`handBlinds`, which is the one place a stored hand's blinds are read through.
