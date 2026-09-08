# net

The wire. `types.ts` mirrors the REST payloads, `api.ts` is the fetch layer,
`adapt.ts` reads the fields the server has not shipped yet, `socket.ts` is the
single WebSocket, and `session.tsx` owns the session, the connection state, the
queue and the match to return to.

## Socket contract

The session is a cookie the server sets on the first `GET /api/me`, so the
socket is opened only after that call succeeds. **A server that is not answering
therefore never produces a reconnect storm and never logs a failed WebSocket
connect**: the home page shows its offline state instead.

`socket.ts` holds one connection for the whole app. It reconnects with
exponential backoff (500 ms to 8 s, jittered), pings every 20 s, and buffers
sends while the socket is down. Sends are typed `ClientMsg`; subscribers get
every `ServerMsg` and filter for themselves (`useServerMsg` in `session.tsx`).

Queueing sends `{t:'queue', mode, rated, speed}`; the picker on the home page
owns all three and `session.tsx` remembers them in `localStorage`
(`ot-play-choice`), so "play again" repeats the match that just finished.
`readPlayChoice()` returns null until something has been played, which is how
the picker knows not to claim a mode was played last on a first visit. A choice
saved before speed existed reads as `standard`, the same default a stored format
without one has.

**The ready check is session state, not page state.** A matchmade table is
offered before it is dealt, and `session.tsx` holds the one open check in
`readyCheck`, opened and closed only by the server's own `ready` messages. It
is here rather than on the home page because the whole point of a ready check
is that it reaches you wherever you are; `../ui/ready-check.tsx` is the modal
mounted once in `../app.tsx`. `answerReady` stamps this browser's own answer
locally as well as sending it, so the button settles on the press while the
counter beside it keeps following the server.

A **cancelled** check puts everybody who accepted back at the front of the
queue, so the screen goes back to `searching` carrying `readyCancelledText` as
the reason rather than to idle with nothing to explain the jump. Three `err`
codes end a search rather than reject an action, and all three land the same
way: `bots_busy`, `ranked_locked` and `cooldown`.

Acting sends `{t:'act', m, h: view.h, n: view.n, a, v}` and disables the bar
until a state with a different `h:n` arrives. The server refuses a stale action
with `err`, so a replayed act is rejected rather than misapplied.

**`/api/me` is refetched** after `end`, and after claim, login and logout. A
finished match has just moved the rating, and the top bar was still showing the
value from before it. Claim and login also merge the summary they return so the
name changes immediately, with the refetch behind it for the counts.

**The match to return to** is remembered in `localStorage` whenever a `state`
arrives with a seat for you, and cleared on `end`. On load it is offered only
after `GET /api/matches/:id` confirms the match is still playing: a match that
finished while the tab was closed is not a match to return to.

Two other subscriptions are pushed rather than polled, and both re-send on every
reconnect rather than only on mount, because the server drops them on
disconnect: `{t:'arena', a}` for an arena board and the `lobby` message a home
game's seats arrive on. See `../routes/CLAUDE.md`.

## REST contract

Shapes mirror `server/src/routes.ts` exactly; `types.ts` is the mirror, and
dates are strings there because JSON has no Date.

**A hand's primary key is `<match id>-<number>`** (`server/db/schema.sql`), so
`/m/:id/h/:n` addresses `GET /api/hands/<id>-<n>` with no lookup step. If that
key ever changes, `api.hand()` is the one place to change.

**Every rating and delta is rounded at the display site** (`int` and `signed` in
`../ui/format.ts`). The server sends integers, but a fraction must never reach
the screen: a delta was once rendered as "+162.31089256906034". Rounding where
the number is printed does not depend on the producer staying correct.

One thing the endpoints do not carry, left out rather than invented: **per-hand
study on the match page** beyond the accuracy column. The full decision list
lives on the replay page, which has the hand row.

## adapt.ts

**Fields that are pending, transitional or shaped two ways go through
`adapt.ts`**, never read directly: mean preflop accuracy on `/api/users/:name`,
per-seat accuracy on the hands list of `/api/matches/:id`, a seat's bot flag,
`place`/`players`/`rated` on a profile's match history (a placing needs both
halves before "1st of 6" can be said at all), a hand row's `live_seats` and
starting stacks, a bot level's average rating, an avatar seed, a picture version
(`avatarVersion()`, where absent and zero both mean "no picture, draw the
generated one"), and the per-mode readers below. That file is the single place to change when the names are
confirmed, and the UI above it never learns a name.

Absent and null both mean "no number", and the caller hides its tile or column
rather than printing a zero. A real zero (a hand scored 0% accuracy) still
shows, which is why `../test/adapt.test.ts` distinguishes the two.

## Ratings are per mode

A six-max result never moves a heads-up rating, the way a chess site keeps
bullet and blitz apart. `UserSummary.ratings` is a `ModeRating` per mode and it
is the real answer; the flat `rating`, `rd` and `provisional` on the wire are
the heads-up standing, kept for compatibility. **Nothing outside a match reads
the flat fields.** `modeRating(summary, mode)` is the only way in, and it falls
back to the flat fields for heads-up so the client keeps working against a
server that has not shipped the map. Every other mode then reads as never played
rather than borrowing the heads-up number.

`ratingHistory` is one line per mode for the same reason, and
`ratingHistoryFor()` reads a flat array as the heads-up line. `/api/leaderboard`
takes `?mode=`, one ladder each. `modeWinRate()` counts wins over decided
matches with draws in the denominator, which is how the server computes the one
flat win rate it sends, so the two can never disagree on screen. Each standing
carries its own `peakAt`; `modePeakAt()` falls back to the flat one, which is
the heads-up date, and says nothing for any other mode rather than borrowing it.

**A casual match still comes back with a ratings map**, unchanged on both sides.
None of it reaches the result screen: no rating, no delta, no deviation, just
one muted line under the heading saying there was no rating change. The gate is
`match.rated`, not whether a rating happens to be there.

Where the mode comes from on each screen:

| Screen | Mode |
| --- | --- |
| top bar | `queue.mode`, the mode last played or chosen |
| home cards | each card shows its own mode |
| home top ten | `queue.mode`, so the board matches the button above it |
| leaderboard | its own tab, opening on `queue.mode` |
| profile standings | both, one row each |
| profile rating line | its own tab, opening on whichever mode has more matches |
| seat, result panel | the match's own mode, which the server already resolved |

A mode with no rated matches says so rather than showing the 1500 everyone
starts on as though it were earned.
