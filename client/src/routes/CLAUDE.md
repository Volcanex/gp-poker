# routes

The pages. `learn/` has its own doc; the table itself is `../table/`, the tools
are `../tools/` and the puzzles are `../puzzles/`.

| Path | Page |
| --- | --- |
| `/` | the picker, how it works, top ten (`home.tsx`) |
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

## The picker

The home page is the play panel and three cards beside it, the shape a games
site settles on: everything that starts a match in one column, everything that
is not a match beside it. It is the one page wider than `.page.wide`, because
that layout needs the width, and **all of its styling is in `home.css`**: the
shell owns `app.css` and the two were built at the same time.

Above it, one row naming the player: picture, flag, name, and the rating for
the game the panel is pinned to as the largest number on the page. A mode with
no ranked match behind it says so rather than printing the 1500 everybody
starts on as though it were earned.

**The panel is one pinned format, three switchers and one button.** Speed,
stake and table size, each a `Segmented` (`../ui/segmented.tsx`), which is g's
shipped tabs and not a new component: g-system ships no segmented control, and
the rule is to use what exists rather than invent one in a consumer repo.
`ModeTabs` is the same component with the modes in it, so there is one copy of
the co-ownership rules with g-ui rather than two.

**The pin is the game this player plays most**, `mainModeOf` in
`../net/adapt.ts`, which is the rule their profile opens on, overridden by
whatever they last chose (`readPlayChoice`). It is resolved a second time when
the account lands, because the first render happens before `/api/me` answers.
`modeBlurb(mode, speed)` is built from `formatFor`, so the line under the
switchers cannot promise a table the button will not deal.

**Ranked is disabled until one casual or practice match has finished.** The
server refuses it either way (`server/src/CLAUDE.md`); the control says so
rather than letting somebody press a button that answers no. It reads
`me.rankedUnlocked`, and a page that has not heard from the server yet assumes
open, so the control does not flicker shut on load. `/api/me` is refetched on
every `end`, so it flips the moment the first game finishes.

Under the button, the four other ways to play are **one line each**, with a
Phosphor icon. Practice, a challenge link and a home game open their own
controls in place rather than on four more cards; the arena is a link, because
joining one is a thing you do beside the board you are joining. `@phosphor-icons/react`
is used here and nowhere else on the site yet.

**No middle dot separators.** They are banned in this UI, so the counts strip
and the site footer separate with space and the page carries none.

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

The page opens on a **headline**: the rating in the mode this player actually
plays, as the largest number on the page, with the peak under it and where it
puts them beside it. That is what a rating is for, and a number with no scale
next to it says nothing, so the card carries "Top 12% of heads-up players", a
bar filled to the share of the field they are above, and "Rank 34 of 280". What
the field is, and why a bot and a never-played mode have no place in it at all,
is `server/src/CLAUDE.md`; `main` is the mode with the most rated matches, and
`mainMode()` in `../net/adapt.ts` falls back to the same rule when the server
predates the field.

**The headline and the rating line share one mode**, the one the tabs under the
card pick, so the big number and the curve below it are never two different
modes at once. Insights keeps its own switch. The card holds its box across both
states: the number sits in a slot four digits wide and one line tall, so an
unrated mode, a three digit rating and a four digit one all leave the page under
it still.

**Level sits beside the name and the badges sit under the rating card.** Level
is how many matches have been finished and nothing else, which is why it is
beside the name rather than in the card holding the rating: one is how much
poker has been played and the other is the skill claim, and a page that put
them together would blur them. Both are derived at read time from counters
already on the payload (`levelOf`, `profileBadges` in `../net/adapt.ts`), so
nothing is written when either is earned. Somebody who has finished nothing
gets neither section rather than a level nought and a row of grey promises; a
bot gets neither either. Unearned badges are drawn dimmed beside the earned
ones, because a row of six with two lit is information and two alone are
decoration.

**Every class in `profile.css` is prefixed** (`rating-hero`, not `hero`). The
app's stylesheets are one global sheet with no modules, and the short names were
taken: `.hero` is the home page's lede and `.rank` is a centred cell in the
tools grid. Both silently reshaped this card before it was renamed.

The rest of `profile.css` is the insights block: the two small charts (net big
blinds by seat, where hands end) that g-system does not ship, drawn from the
same tokens as the rating graph and for the same reason `g.chart` is not used
(`../ui/CLAUDE.md`). The percentile bar is not one of them: it is g's shipped
`.g-progress`, with the width written inline and the aria values set, so g-ui's
own pass over it computes the same number rather than resetting it to zero. The
insights numbers come from `/api/users/:name/insights`, which the server derives
by replaying stored hands, and a group below twenty hands comes back null rather
than as a claim.

Which mode each screen is showing, and why a mode with no rated matches says so
rather than printing 1500, is in `../net/CLAUDE.md`.
