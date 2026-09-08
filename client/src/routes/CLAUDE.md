# routes

The pages. `learn/` has its own doc; the table itself is `../table/`, the tools
are `../tools/` and the puzzles are `../puzzles/`.

| Path | Page |
| --- | --- |
| `/` | queue, how it works, top ten (`home.tsx`) |
| `/arena` | the arena running now, or the next one, its board, and the last three that finished |
| `/arena/:id` | one arena, readable for good once it is over |
| `/leaderboard` | top 100 (`leaderboard.tsx`) |
| `/u/:name` | profile (`profile.tsx`) |
| `/watch` | live tables, and the ones that just finished (`watch.tsx`) |
| `/c/:id` | a friend's challenge link: who is challenging you, the format, one button that starts the match (`challenge.tsx`) |
| `/g/:id` | a home game lobby: the chairs, the link to share, the host's start (`home-game.tsx`) |
| `/m/:id` | live table while playing, spectator seat if you have none, result summary once finished (`match.tsx`) |
| `/m/:id/h/:n` | hand replay, scrubber and fairness checks (`replay.tsx`) |
| `/m/mock` | the scripted table, dev only (`?step=N` freezes one moment, `?mode=six-max` runs the six-handed script, `?watch=1` drops the seat) |

Three more groups are mounted into the same router from the directory that owns
them, as a route list rather than as individual entries in `../app.tsx`:
`learnRoutes` from `learn/`, `puzzlesRoutes` from `../puzzles/` and `toolsRoutes`
from `../tools/`. Adding a lesson, a puzzle or a tool is a file plus a line in
that list, and the router never has to know what any of them is.

`useTitle` (`../ui/title.ts`) sets the document title per route and appends the
product name, so it is spelled in one place.

`feed.tsx` is not a page. It is the live counts and the finished-match row, kept
here because the home page and the watch page both draw it and neither owns it.

## Watching

`/watch` lists the live tables from `/api/live` on a five second clock, with
`/api/recent` under it. A row opens `/m/:id` like any other match link, and
whether that is a table or a spectator seat is the server's answer, not the
route's: `view.you == null` is the whole test.

Watching adds a strip above `.match` carrying the badges and who is playing, a
fourth dock state (`watch`) holding the live status and the way out, and an empty
key legend, because a spectator has no keys to press. The strip is row 1 of the
table's own grid and the legend is row 6, so the header, the felt and the dock
keep one box in every state (`../table/CLAUDE.md`). `/m/mock?watch=1` runs the
mock script with the seat removed, which is how the watching table is
screenshotted without a live match.

## The arena

`/arena` is the arena running now, or the next one if none is; `/arena/:id` is
one arena, and a finished one stays readable there for good. One component
serves both (`arena.tsx`), because the only thing the id changes is which call
fetches the board and whether the finished list is drawn under it.

The board arrives twice over, the same bargain the home game lobby makes: once
from the request the page opens with, and after that pushed over the socket to
everybody watching. The page **says** it is watching (`{t:'arena', a: id}`, and
`null` on unmount) rather than the server inferring it from who joined, because
watching an arena and being in one are different things. The server drops the
subscription on disconnect, so the effect depends on `conn` and re-sends on every
reconnect. A page whose socket never opened polls `api.arena(id)` every ten
seconds instead, and stops once the arena is over.

`arena-bits.ts` is the pure half: the countdown, the line the home page card
reads, the board's shape and the flame's threshold. It is separate for the reason
`home-game-seats.ts` is, and it is why the home card and the arena page cannot
describe the same arena differently. **`ARENA_FIRE_FROM` is read from the
protocol**, not written here: the flame is a promise about what the server is
about to pay.

Three things the page owes the states it can be in. A running arena whose clock
has run out is not over, because the matches paired before the end are played out
and scored, so it says "finishing the last matches" rather than counting into the
negative. A finished arena drops the `paused` tag from its rows, since nobody is
paused in an arena that has stopped pairing. And the result panel at an arena
match reads "Back to the arena" and goes to `/arena/:id`, because the next match
is the arena's to give and not the queue's (`match.tsx` picks that off
`format.arena`).

## The two shared links

`/c/:id` and `/g/:id` are the visitor's side of a link somebody sent. A
challenge is a link instead of a queue and needs no lobby, so accepting it is
what creates the match: both sides are then told by the same `q found` the queue
sends, and the creator's waiting card navigates without knowing a challenge
existed. Six seats cannot start themselves that way, so a home game is a lobby
instead: the host holds a seat like everybody else and says when it starts, and
everyone seated is pushed a `lobby` message on every change so the page fills in
without polling. A page whose socket is not open asks again every five seconds.

`home-game-seats.ts` is the pure half of the lobby: who is sitting where, and
what happens to the chairs nobody took. `ShareLink` (`../ui/share-link.tsx`) is
the address row both pages use. A home game is **rated only with two humans in
it** and the server says so in its answer rather than changing the choice
quietly, so the page prints the reason it was overridden.

## The profile

`profile.css` is the insights block under the rating graph: the two small charts
(net big blinds by seat, where hands end) that g-system does not ship, drawn from
the same tokens as the rating graph and for the same reason `g.chart` is not used
(`../ui/CLAUDE.md`). The numbers come from `/api/users/:name/insights`, which the
server derives by replaying stored hands, and a group below twenty hands comes
back null rather than as a claim.

Which mode each screen is showing, and why a mode with no rated matches says so
rather than printing 1500, is in `../net/CLAUDE.md`.
