# tournaments

The arena's sibling. An arena is a rolling pairing with a running score; a
tournament is a field that funnels up to a final, so a result depends on a run
of matches rather than on a total. Three fixtures on a fixed calendar, no admin,
and the same two rules the arena's background work obeys.

| File | Owns |
| --- | --- |
| `fixtures.ts` | the calendar: the three fixtures, their names, shapes, seat caps, bot floors, and when each one is next played. Pure, UTC, no clock of its own |
| `draw.ts` | the draw: a field to tables, a round's results to the next round's field, and a round to a place. Pure arithmetic over seed numbers |
| `index.ts` | the scheduler, registration, the rounds, the views and the live board |

`../db.ts` holds the queries and `../../db/schema.sql` the three tables.

## Why three files

`fixtures.ts` exists because a fixture's name and slot must be written once.
The brief for this feature said so and the reason is the same one behind
`BOT_LEVELS` in the protocol: a name in two places is a name that drifts. The
client never holds a copy of the calendar; `blurb` and `note` travel on the
payload.

`draw.ts` exists because every rule in it is a claim about a field size that is
either right or wrong, and proving "the byes go to the top seeds" by playing a
tournament is a slow way to learn it is not. `../../test/tournament.test.ts`
drives both files with no database at all.

## The two shapes

A **bracket** is heads-up single elimination. Seeds are laid out by doubling
(`bracketSlots`), which is what makes seed 1 meet the bottom seed and the top
two meet only in the final; a field that is not a power of two leaves the
bottom slots empty and those are the ones the top seeds are paired against, so
the byes land on them for free. Later rounds are **positional**: the winners of
tables 2j and 2j+1 meet at table j, which is what makes a bracket a bracket.

A **shootout** is six-max tables playing down. `shootoutTables` balances the
field six to a table at most and never below three, which falls out of the
division rather than being corrected afterwards. `snakeSeats` serpentines the
seeds across the tables so no table collects the strong ones, and it is safe to
give a uniform gap because the pitch is what matters, not the offset. Later
rounds are **re-seeded**: the survivors are snaked again.

`advanceCount` is the rule the brief states: one table is the final, two tables
send three each (a six-handed final), anything more sends two, because three
from three tables is nine and nine does not fit at a table.

## Places

The final table's own places are the top of the sheet. Everybody else is placed
by the round they went out in, tied within it, at one past however many players
were still in after that round (`placeForRound`). Four survivors and the
round's casualties are all fifth, which is how a bracket has always been read.

The one subtlety is the final round. A player who withdrew at the final's ready
check has to be placed under everybody who actually sat down, so the final
round's survivor count is the size of the final table's result rather than the
number that advanced into it, since nobody advances out of a final.

Every place comes from `tournament_players.out_round`, not from the tables'
seat lists. A withdrawal is stamped with its round when it happens, so a player
who never sat at the table they were assigned to still has a place, and a page
can say "out in round two" while the tournament is still running.

## The scheduler

`tournamentTick` is one pass, exported the way `arenaTick` is: stock the
calendar, start whatever the clock says to, settle any running round whose last
table has landed. Everything is wrapped, because this runs from a timer nobody
awaits and a rejection would take every live match with it.

**One upcoming row per fixture is the whole of "at most three upcoming and
never zero".** A fixture whose row has started has no upcoming row, so
`ensureSchedule` writes the next one on the very next pass: registration for
tomorrow's bracket opens the moment today's begins. `(kind, starts_at)` is
unique, so two processes stocking the same calendar produce one row.

**A round is settled by whichever gets there first**, the finished-match
listener or the tick, and `settling` is the lock that stops both starting the
next round. `settleTournament` loops rather than settling one round a call,
because a round every table of which was a bye is over the moment it is
written and the next one has to start in the same pass.

**A field under the shape's minimum is cancelled** (`TOURNAMENT_MIN_FIELD`, four
for a bracket and six for a shootout, in the protocol because the registration
card says how many are still needed). A tournament whose winner beat nobody is
worse than one that says nobody came, and `cancelled` is the status an arena has
no need of.

## A table

Four outcomes and only one of them deals a hand. No seats at all is a table
whose feeders sent nobody; one seat is a bye or a walkover; two or more is a
match. `dealTable`'s `check` argument is false on a replay, because a **drawn
heads-up match is replayed at once** and asking two people who have just played
the hand cap whether they are still there is asking a question they have
answered.

Every seat gets a ready check before its table is dealt, on the queue's twenty
seconds (`readyMs` is a seam so a suite proves a walkover in milliseconds).
**Silence or a decline withdraws that player from the tournament and costs them
nothing else**: there is no walkout to charge, because nobody is left waiting at
a table that has not been dealt. Their opponent gets a walkover, a six-max table
plays on without them, and a table left with one player advances that player.

A tournament table outranks whatever a seat was doing alone, so `vacateFor` is
called one seat at a time: it refuses the whole group when any one of them is in
a match with another person, and a tournament cannot wait on somebody else's
game.

## Rated, and the doors

Speed is **fast** for every tournament match, which is what bounds a round: the
twenty minute ceiling means a round cannot run away with the evening.
`format.tournament` carries the id, the round and the table, and it is the only
thing that makes an ordinary match a tournament one.

Heads-up tournament matches are **rated**, like an arena's. A six-max table is
rated only with two or more people at it and forced casual otherwise, which is
the home game's rule and the same reason: five bots of a strength nobody chose
is a rating anybody could dial in.

**Registration is not a ranked door**, which makes it the one place on this site
that can produce a rated match without asking what `enqueue` and `joinArena`
ask. Both of those questions are about a table that is about to be dealt, and a
fixture is entered hours ahead of being played: somebody who registers for
tonight's bracket has all afternoon to play the casual game that opens rated
play, and refusing them the seat would refuse them the thing they came for. A
walkout ban is worse to ask about here rather than better, since one that runs
out before the start would have cost them the fixture. **If that turns out to be
the wrong call, the fix is a check inside `dealTable` and a withdrawal, not a
check at the door.**

## Bots

`fillableTournaments` is what `../bots/population.ts` reads: the fixtures inside
the registration window with what is already in them. The population registers
bots whose own weekly schedule says they are online **at the start**, not now,
up to the fixture's `botFloor` and never above the seat cap.

**People are never refused a seat by a bot.** When the field is full and a person
registers, the bot that registered last is withdrawn to make room; a field full
of people is full, and a bot that finds it full simply does not play.

## Seams

| Seam | For |
| --- | --- |
| `configureTournaments({now})` | a whole fixture opens, plays its rounds and finishes against a fake clock |
| `configureTournaments({format})` | the match format, the same seam the arena's is: one hand on a short clock |
| `configureTournaments({readyMs})` | a walkover proved by a decline rather than by sitting out twenty seconds |
| `configureTournaments({fixtures})` | one fixture rather than three, so a suite's clock is not shared |
| `tournamentTick`, `settleTournament` | one pass, driven by the test instead of by an interval |
| `resetTournaments` | back to the configured defaults, so the next file does not inherit a clock |
