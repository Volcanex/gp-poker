# Workstream: tournaments (brackets and shootouts)

Worktree `/home/gabriel/opentable-wt-tourney`, branch `tourney`, private DB
`opentable_test_tourney`, preview port 4212, dev server port 8232. Read
`agents/_shared.md` first, then `server/src/arena.ts` end to end: the
tournament scheduler is the arena's sibling and should read like it.

## Why
The only competitive event today is the hourly arena (rolling heads-up
pairing, a score board). Gabriel wants real tournaments beside it: brackets
that funnel up to a final, on a fixed calendar, at most three upcoming at once,
clean and dignified. Fixed fixtures, calm names, nothing tacky.

## The fixtures (exactly these; a scheduler keeps the next one of each)
| Kind | Shape | Seats | When (UTC) |
| --- | --- | --- | --- |
| Daily bracket | heads-up single elimination | 32 | one a day, rotating through three slots: 20:00, 02:00, 11:00, advancing one slot each day (day number mod 3), so it lands in the evening somewhere different each day |
| Sunday shootout | six-max shootout to a final table | 36 | every Sunday 18:00, except the first Sunday of a month |
| Monthly championship | six-max shootout to a final table | 216 | first Sunday of the month, 18:00 |

Registration opens when the row is created (the scheduler creates each kind's
next fixture as soon as the previous one starts, so there are at most three
upcoming and never zero) and closes at the start. Withdraw any time before the
start. No late registration. Names, kinds and the schedule are data in one
place (`server/src/tournaments/fixtures.ts` or similar), not scattered.

## Rules
- **Speed is fast for every tournament match** (the twenty-minute ceiling
  bounds a round). `format.tournament = {id, round, table}` marks a match,
  the way `format.arena` does; the matches are ordinary matches on ordinary
  public pages, created through `createMatchForPlayers`.
- **Rated**: heads-up tournament matches are rated (as arena matches are).
  Six-max tables are rated only when two or more humans sit at them, forced
  casual otherwise, the home-game rule; reuse whatever decides that.
- **Seeding** by the mode's rating at the start. Heads-up: standard bracket
  seeding (1 v N, 2 v N-1 ...), byes to the top seeds when the field is not a
  power of two. Six-max: tables = ceil(N / 6), sizes balanced (never below
  three at a table), players snake-seeded across tables by rating.
- **Advancing.** Heads-up: the winner. A drawn heads-up match (equal stacks
  after 25 hands) is replayed at once until decided. Six-max: with T tables
  this round, if T = 1 it is the final and its places are the places; if
  3T <= 6 the top three of each table advance (so two tables become a
  six-handed final); otherwise the top two. Places at a six-max table are the
  elimination order the match already records.
- **Rounds.** A round starts the moment the last match of the previous round
  settles. Every seat gets a ready check (`server/src/ready.ts`, the queue's
  twenty seconds) before its table is dealt. Silence or decline withdraws that
  player from the tournament, no walkout penalty: a heads-up opponent gets a
  walkover, a six-max table plays on without them, a table left with one
  player advances that player without dealing. Players are told their table
  exists with the same `q found` the arena uses, so the client walks them to
  it; a finished tournament match offers "Back to the tournament" the way an
  arena match offers its board.
- **Places and results.** `tournament_players.place` for everyone (final
  table by its places; earlier eliminations placed by the round they went
  out in, tied within a round), a `podium` on the tournament row as arenas
  have, `status upcoming | running | finished | cancelled`. A profile shows
  tournament wins and podiums in its headline tile if that is cheap; at least
  a "Tournaments" list on the profile with place and link.
- **Bots.** The population (`server/src/bots/population.ts`) registers bots
  that its schedule says are online at the start, in the last hour before the
  start, up to a floor per kind (daily 16, Sunday 24, monthly 48) and never
  above the seat cap. People are never refused a seat by a bot: if the cap is
  reached and a person registers, withdraw the last bot to make room. Under a
  minimum (heads-up 4, six-max 6) at the start with no population (tests),
  the tournament is cancelled and says so. Bot tournament play drives through
  the same virtual-socket path bots already use for the queue and the arena.
- Background work obeys the arena's two rules: nothing throws out of a tick,
  and the clock, the fixture calendar and every delay are injectable seams
  (`configureTournaments`, `tournamentTick`) so tests drive a whole tournament
  against a fake now.

## Client
- `/tournaments`: the three upcoming, one per kind, each a card with the
  name, one calm line saying what it is, the local start time and a
  countdown, entrants so far over the cap, and Register / Withdraw. A single
  quiet sentence explains the daily's rotation. Below: running now, then past
  results (winner, field size, date) paged.
- `/t/:id`: the tournament page. Before the start: the entrant list by seed
  with flags and ratings, Register / Withdraw, countdown. Running and after:
  heads-up shows a **bracket** (rounds as columns, matches as small cards with
  both seeds, the winner marked, live matches linking to `/m/:id`, connectors
  between rounds drawn with CSS or inline SVG, horizontally scrollable inside
  its own container on phones); six-max shows **the funnel** (rounds as
  bands, each table a card listing its seats with place, the advancing seats
  marked, the final table set apart), with your own seat always highlighted.
  Live updates through a `tournament` subscribe message pushed like the
  arena's board (`{t:'tournament', id}` from the client, a `tournament`
  server message back), not polling.
- Home: `TournamentsCard` in the `.home-under` slot of
  `client/src/routes/home.tsx` (the `{/* TournamentsCard */}` comment; leave
  the `{/* FriendsCard */}` comment where it is, another branch fills it): the
  next three, name, local time, countdown, entrants, a Register control that
  works in place, and a "You are in" state. The card links to `/tournaments`.
- The sidebar gets Tournaments beside Arena. The arena card and page are
  untouched except where a shared piece (the "back to" control) is made
  common.
- Tests: server tests that drive a 5-player heads-up bracket (a bye, a
  walkover on a declined ready check, a replayed draw if you can force one)
  and a 13-player six-max shootout (three tables to a final) through
  `tournamentTick` with a fake clock, checking places and podium; the
  fixture calendar (next daily slot rotation, first-Sunday rule, "at most
  three upcoming"); registration caps and bot displacement. A Playwright
  script screenshotting a bracket and a funnel at 1280 and 390 wide.
- Docs: root `CLAUDE.md` Decisions bullet in the arena bullet's voice,
  `server/src/CLAUDE.md`, a `server/src/tournaments/CLAUDE.md` if you make
  that directory, `client/src/routes/CLAUDE.md`.

## Out of scope
Friends and invites (another branch), changes to arenas' rules, prizes or
tickets of any kind (there is no currency on this site and there will not be
one), custom or user-created tournaments.
