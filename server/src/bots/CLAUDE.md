# bots

The bot population, one bot's message loop, the persona layer, and the pure
decision function.

## A bot plays a tier, not a number

`BotTier` and `LEVEL_TIER` live in the protocol. **Nothing in this directory
branches on a level number**: `decide` dispatches on the tier, the roster
derives which levels think from the tier, and the budget table is keyed by
tier. That is what makes the coming renumbering a one-table edit rather than a
search through five files for integer comparisons.

## Shape
- `strategy.ts` - `decide(view, rng, level, persona)`. Pure: same `TableView`
  a browser gets in, one legal action out. No socket, no room, no database,
  so every branch is reachable from a synthetic view.
- `persona.ts` - `Persona`: a handful of multipliers (`looseness`,
  `aggression`, `bluffChance`, `callCap`) nudging a level's baseline, and the
  seven named `Archetype`s (`nit`, `station`, `maniac`, `tag`, `lag`,
  `tilter`, `tourist`) that `population-roster.ts` draws them from.
- `geography.ts` - one representative IANA timezone per country a bot can be
  assigned, and `localTimeAt`, the `Intl`-based local-hour/weekday reader
  every schedule check runs through.
- `population-roster.ts` - pure: who each bot is (`generatePopulation`) and
  when it plays (`weeklySessions`, `isOnlineAt`). No database, no clock
  beyond the `Date` a caller passes in.
- `population.ts` - the live scheduler: every 30s, decides which loaded bots
  are online right now and sends the ones that are to queue.
- `player.ts` - `BotPlayer`. Holds a level and a persona, thinks on a timer
  capped against the decision clock, answers through the ordinary client
  router, and says the odd line through the same path.
- `index.ts` - turns the population into database rows and live
  `BotPlayer`s, and answers who is free, who is queued, and the summary
  `/api/bots` serves.

## Thinking time is a function of the format, not of the bot

One `BotPlayer` instance is loaded per bot account for the life of the process
and plays a rated queue fill, a practice table and a ladder match one after
another, so the pacing cannot be fixed at construction: `thinkRange(format,
trivial)` reads `format.practice` on every decision instead. A practice table
(a person against bots) gets the slower `PRACTICE_*` ranges, 1400-3200ms for a
real decision and 200-800ms for a trivial one (a check, a call that costs
nothing); everything else — a rated or casual queue fill, a filled heads-up
seat, the ladder — keeps the ranges that existed before practice tables had
their own pacing. Both are still capped against a quarter of `format.clockMs`
exactly as before, so a short test clock is unaffected either way.

## Seven levels, five tiers in one function
`decide` takes a level, default 4. **Level 4 is the bot that existed before
levels did, byte for byte**: `server/test/strategy.test.ts` pins it and must
keep passing untouched. Every other level reuses the same `Ctx`, the same
`handStrength` and the same action helpers (`aggressive`, `passive`,
`giveUp`), and differs only in named constants and which rule it reaches for.

- 1 and 2 replace the chart read with a percentile threshold and lose by
  calling too much; 3 is the same read but price-aware and too passive.
- 5 is level 4 plus semi-bluffs, a continuation bet, board-aware sizing,
  thinner river value, an occasional 3-bet bluff, and a margin on its calls.

`decide` maps a thinking tier onto `sharp` rather than falling through to its
default branch, so a view that reaches the pure function with a tier it does
not implement plays the nearest thing rather than silently playing `solid`.

**Level 5 bluffs less than its description suggests, on purpose.** Every level
below it calls a bet down to about a quarter of the pot in equity, so against
the field it actually plays there is almost no folding equity to win: the
money is in value bets and in not paying off. Turning the bluff frequencies up
makes level 5 lose to level 2. This is tuned against these opponents, not
against a solver.

## The two tiers that think

Everything above is one number: the fraction of remaining holdings the bot's
hand beats. `regular` and `solver` are the first that have ranges. They track
both of them through the hand (chart reads preflop, and postflop a lean by made
hand strength for the opponent and the exact solved strategy for itself), build
the subgame in front of them and run CFR+ on it. `@opentable/solver` holds all
of that; `packages/solver/CLAUDE.md` has the sizes, the budgets and what the
solve is and is not.

**`solver` solves every postflop street** on a 1500ms budget: the river
exactly, the flop and turn against a depth limited leaf.

**`regular` solves only the river**, on 400ms, and plays the sharp tier
everywhere else. It is not a worse solver, it is a different bet about where
the money is: that a measured read on the person in front of it beats a depth
limited guess at two streets of play. It carries four deviations from the sharp
tier, each driven by a statistic and each a no-op until its sample arrives, so
a bot with no read plays exactly the sharp tier. It raises for thin value
against a wide VPIP, fires a checked street against somebody who folds to flop
bets more than the price, sizes value up against somebody who folds less than
the price, and gives up a bluffcatcher against somebody who rarely bets.

**A thinking tier owns the whole hand.** It asks its own fallback for the
streets it does not solve rather than returning null and letting the caller
choose, because a hand where somebody else made half the decisions is a hand
where our own range is a guess. The fallback is injected, not imported: the
solver package has no business reaching into the server for the older tiers.

A few things about them belong here rather than there.

**It runs on the main thread, in slices, and not in a worker.** A worker was
the plan. The server ships as one esbuild bundle (`server/build.mjs`) because
the workspace packages are TypeScript source with no build of their own, so a
worker entry point needs a second bundle in production and a TypeScript loader
inside a worker thread in dev, which Node does not carry across the thread
boundary. That is two code paths for how the bots think, and the one that only
exists in production is the one nobody exercises. The price is a property the
solver has to keep: nothing it does may block for longer than a single CFR
iteration, a couple of milliseconds. `solver.ts` runs iterations for about
eight milliseconds, hands the event loop back, and goes again until the budget
is spent, so a websocket behind a thinking bot waits about ten milliseconds.

**Two solves at a time, and a third falls back.** A bot that answers on time
with a sharp tier decision beats a bot that answers late. The regular tier
solves one street in four, so a table full of them costs about a quarter of
what a table of solvers does, which is most of the reason it exists.

**The ladder gets a fifth of the budget.** It plays bots against each other in
every gap when nobody is here, one match after another, so two thinking
accounts meeting there at the full budget would keep a core busy around the
clock on a box that runs everything else Gabriel has. Nobody is watching a
ladder match, so it gets 250ms and a slightly worse bot.

**It is not multiway.** The solver is heads-up. A six-max hand gets level 5
until it is heads-up postflop, at which point it is solved like any other.

**The solver tier deviates from the solve in one place**, and without that
deviation it loses. An equilibrium bluffs to make the opponent indifferent; every level below
this one calls a bet down to about a quarter of the pot in equity, so those
bluffs are pure donations. It measures how often an opponent has actually
folded to its bets and cuts the bottom of its own betting range in proportion
to how far short of the price that is. Seeing a fold at all needs plumbing: a
fold ends the hand, so the bot is told when a hand finishes
(`observeSolverResult`) and counts a bet nobody answered, unless somebody
showed a hand.

## The benchmark

`../../scripts/bench-bots.ts` is where a thinking tier's claim lives, because
"beats the tier below" is a number with an interval and not a test that passes.
It plays the same duplicate design the ordering test uses and reports big
blinds per hundred hands with a standard error, plus the decision latency. The
ordering test does not include them: they think for a real fraction of a second
per decision, which is a benchmark script and not a unit test.

Where the solver tier stands, measured 2026-09-09 on h with a 500ms budget of
processor time (the live budget is 1500ms of wall clock, so these are a floor).
It was level 6 when these were taken and is level 7 now; the tier is what the
rows are about.

| matchup | stack | hands | bb/100 |
|---|---|---|---|
| solver vs sharp | 30bb | 480 | -9 ± 27 |
| solver vs solid | 30bb | 480 | **+49 ± 22** |
| sharp vs solid | 30bb | 480 | +30 ± 18 |
| solver vs sharp | 100bb | 320 | -6 ± 92 |
| solver vs solid | 100bb | 400 | +176 ± 76 |
| sharp vs solid | 100bb | 400 | +205 ± 43 |

**So the solver tier is the sharp tier's equal, and it beats solid by more than
sharp does. Solver over sharp is not demonstrated.** The interval on the direct
matchup covers zero at both stack depths, and the only hint the other way is
the indirect one: 49 against solid where sharp manages 30, on the same deals.
That gap is the whole reason the regular tier exists: a tier that reads the
person rather than the tree is a different bet about where the money is.

How it got there is worth more than where it got to, because the distance
travelled is all range modelling and none of it is the solver. Against the
sharp tier at a hundred big blinds the first working version lost 455 bb/100.
Fixing the population blend, then the bet size read, then tracking our own
range by the strategy we actually played, then judging a hand against the
opponent's range rather than our own, took it to 143, then 90, then 57, then 6.
Every one of those was a wrong range and not a wrong solve, which is the thing
to remember before reaching for the CFR code.

Latency, wall clock, on a box that was busy with other work: the solver tier is
p50 563ms and p95 1410ms at a 500ms budget, p50 154ms and p95 205ms at 150ms.
The regular tier is p50 0ms, because three decisions in four never reach a
solve at all.

Against Slumbot over its public API (`../../scripts/bench-slumbot.ts`), 400
hands with the seats alternating: -20 bb/100 with a standard error of 104, and
not one action rejected. Four hundred hands says nothing about a win rate
against a bot that solves the whole game, and everything about whether this one
plays legal poker outside its own test suite.

The ordering of the instant tiers is proved, not asserted by hand. `levels.test.ts` plays
a seeded round robin through the engine and reads chips won. It is worth knowing why it
is shaped the way it is before changing its numbers:

- **Short stacks (30bb, not the product's 100).** The biggest pot a hand can
  lose is a third the size, which is most of what gets the gaps clear of the
  noise.
- **Four plays per deal**, both seatings and both buttons, with the two
  seatings of a deal sharing a decision stream from the same starting state.
  Identical strategies then cancel to exactly zero and only real differences
  survive.
- **A round robin**, so no level's total is one lucky matchup.

Without all three the variance is around ±1500 chips and neighbouring levels
swap places from one seed to the next. `handStrength` is memoised, which is
what makes a sample this size run in about twelve seconds.

## The roster is the population

`config.botCount` (`POPULATION_SIZE`, default 120, 15 under vitest so a test
file's boot does not pay to upsert 120 rows) named accounts, generated once
from the fixed seed `opentable-population` by `population-roster.ts`'s
`generatePopulation`. The generator walks the same sequence every time, so
**growing the roster only appends**: bot 0 is always bot 0 no matter how large
`count` grows, which is what lets the original fifteen keep their id, rating
and history under a bigger population. Roster index `i` plays at
`(i % 5) + 1` (`levelForIndex`, unchanged from the original roster), so
levels cycle rather than sitting in blocks.

Each bot also gets, from the same rng sequence: a realistic name and a
country (`@opentable/identity`'s `generateRealisticIdentity`, see its
`CLAUDE.md`), a timezone consistent with that country (`geography.ts`), a
`Persona` (an `Archetype` plus jittered multipliers, `persona.ts`), a weekly
hours budget in one of three tiers (5% grinders, 25% regulars, the rest
casual, `WeeklyBudget`), preferred hours and days shaped into a fixed
recurring weekly `schedule` (`weeklySessions`), a preferred mode and speed, a
`ChatProfile` (see below), and a `createdOffsetDays` backdating its join date
over the previous 18 months so profiles do not all say "joined today",
skewed so a grinder is more likely to be an early account than a weekend
tourist is.

**Migrating the original fifteen.** Two migrations run at every boot,
in order: `migrateBotRoster` (unchanged) renames any surviving pre-identity
`bot-otter` style row onto the CamelCase roster, then
`migrateBotNamesToRealistic` renames that CamelCase roster, positionally by
index, onto the population's realistic handles. Both are idempotent locked
migrations (`db.ts`'s `migrateLegacyBotNames` / `migrateBotNamesToRealistic`):
a database with no rows left to rename does nothing.

`users.bot_level` and `users.country` are re-asserted from the roster on
every boot (`ensureBots` → `ensureBotUser`), which keeps the code the source
of truth for who plays how rather than whichever row was written first.
`created_at` is the one field that is **not** re-asserted: it is only ever
set at insertion, the same way a real account's join date would never move.

## Personas

`strategy.ts`'s `decide` takes an optional fourth argument, defaulting to
`NEUTRAL_PERSONA` (every multiplier exactly 1, which is why passing nothing
is still byte-for-byte identical to the old three-argument call:
`server/test/strategy.test.ts`'s level-4 pin does not know personas exist).
A persona nudges four things, each at one chokepoint rather than scattered
through the file: `aggressive()` scales every bet and raise's target size by
`persona.aggression`; the preflop percentile is divided by `persona.looseness`
before any threshold reads it (percentile 0 is the best hand, so dividing by
a looseness above 1 makes more hands read as playable); a handful of named
bluff-chance constants are scaled by `persona.bluffChance`; and the handful of
call-size caps (`preflopProfile`'s `callCap`, `postflopStation`'s
`STATION_FOLD_POT_FRACTION`, `postflopSharp`'s `SHARP_CALL_MARGIN`, the last
one divided rather than multiplied) are scaled by `persona.callCap`. See
`persona.test.ts` for what actually moves.

The seven archetypes are flavour on top of the five levels, not a sixth
dimension of skill: `ARCHETYPE_DESCRIPTIONS` is the one line each translates
to, and `jitteredPersona` blurs each archetype's numbers by +/-15% per bot so
two bots sharing an archetype and a level still play a little differently.

## Chat

`ChatProfile` (`chattiness`, a `greeting`, a `farewell`) is drawn per bot by
activity tier: grinders speak the most, casual bots almost never, and even a
chatty bot rolls the chance fresh for the greeting and for the farewell, so
having something configured is not the same as saying it every match.
`BotPlayer` sends a greeting a few seconds after joining a found match and a
farewell a moment after `end`, both through the same `dispatch` its own
actions go through: the `chat` `ClientMsg`, exactly what a person's client
would send. `match/room.ts`'s `deliverChat` no longer refuses a sender with
`user.bot = true`; the sparing chance in `ChatProfile` is what keeps a table
quiet rather than a blanket rejection at the room.

## The population scheduler

`population.ts` ticks every 30 seconds. For each loaded bot it asks
`isOnlineAt(bot.schedule, bot.timezone, now)` (pure, from
`population-roster.ts`), and:

- **online, not busy, not already queued** → sends `{ t: 'queue', mode,
  rated, speed }` through `sendBotMessage`, the same `dispatch` a socket
  message drives. `rated` is `rankedUnlocked(userId) && Math.random() <
  0.75`: a bot clears the same one-casual-match gate a human does before it
  can play rated, which is also what makes the ladder's fallback path (below)
  still exercise something real for a brand new population.
- **online, already queued or busy** → left alone; a match in progress is
  never interrupted, even if the bot's session has technically ended
  (`isBotBusy` is checked before `isOnlineAt`).
- **not online, still queued (not yet seated)** → sent `{ t: 'dequeue' }`,
  the way a person would close the tab rather than let a stale search run.

`config.populationMaxTables` is a soft cap on bot-only tables (`liveRooms()`
filtered to every seat having a `levelOf`), checked before each new dispatch;
existing tables past the cap are left to finish rather than torn down.
`config.populationEnabled` (`POPULATION_ENABLED`, off under vitest like the
ladder and the arena unless a test calls `configurePopulation({enabled:
true})`) gates the whole scheduler; `populationTick` is the seam a test
drives directly instead of waiting on the interval.

**Bots now sit in the ordinary matchmaking queue, which they never did
before.** Two things had to change for that to be safe:

- `player.ts` answers a `{ t: 'ready', s: 'pending' }` prompt by accepting
  after a short random delay. Bots used to reach a match only after a
  human's ready check had already passed (pulled in afterwards by
  `availableBots`), so nothing needed to answer one before.
- `index.ts` tracks `isBotQueued` (a timestamped map, self-healing after
  three minutes so a bot whose enqueue silently failed does not stay
  unavailable forever) and `isFree`/`availableBots`/`availableBotsAtLevel`
  all exclude a queued bot. Without this, a bot searching the ordinary queue
  on its own could also be pulled into a practice table or the ladder and end
  up seated at two tables at once.

## Availability
`availableBots` fills the ordinary rated and casual queues, nearest in rating
first, and is untouched by levels. `availableBotsAtLevel` fills a practice
table: the level asked for first, then outwards a level at a time (L-1, L+1,
L-2, ...). Both exclude a bot that is busy in a live match or already
searching the queue on its own (`isBotQueued`, above), and both ask the room
whether it is still `active` rather than whether it exists, because a
finished room lingers for a minute.

Bots are excluded from the leaderboard, from `/api/live`, from `/api/recent`
and from the online/playing counts by default; `config.populationPublic`
(`POPULATION_PUBLIC`, default on whenever there is a population at all) puts
them on all four, because a population nobody can see is not what it is
for. Off, every one of those behaves exactly as it did before the population
existed: see `routes.ts`'s `isVisibleLive` and `getLeaderboard`'s
`includeBots` argument. With the flag on, every public payload also carries
`bot: false` for them (`shownAsBot` in `../config.ts`, applied in
`userView.ts`, `routes.ts`, the table view, chat and the arena board), so no
"Bot" badge, bot level or bot-only profile gives them away: the owner wants
the room to read as people while the population is the userbase. The row
keeps `bot = true` regardless, which is what the reset script relies on.
`/api/bots` always lists the whole roster as bots regardless of the flag; it
is the practice picker's own page, not a public-visibility surface.

## Resetting the population

`../../scripts/population-reset.sql` deletes every `users.bot = true` account
and any match played entirely between them, clearing a bot's `matches.winner`
pointer first where it won a mixed match against a human so the row can stay.
Never run against the live database without checking with Gabriel first; see
that file and `scripts/CLAUDE.md`. `users.bot` staying `true` forever
(nothing ever flips it back) is what makes a reset possible at all: the
population can always be told apart from anyone who has claimed a name.

## The ladder: now the fallback

`../ladder.ts` is unchanged in every way except when it runs.
`server/src/index.ts` starts the population scheduler **or** the ladder,
never both: the population already produces rated bot-vs-bot matches in
public once it is on, which is everything the ladder existed for and more,
so the ladder is what a box running with the population off (or with
`POPULATION_SIZE=0`) falls back to instead. `config.ladderEnabled` and
`LADDER_PAUSE_MS` are unchanged; so is every one of its own tests.

- **Humans first.** A ladder match starts only when the queue is empty and no
  person is at a live table (`liveRooms()` plus `levelOf(id) === null`). One
  already running is left to finish rather than torn out mid-rating.
- **Nothing new is needed to keep the bots free for people**: a ladder match
  registers an ordinary room, so `availableBots` and `availableBotsAtLevel`
  already see its seats as busy. `../../test/ladder.test.ts` asserts it rather than
  assuming it.
- **Pairing** is a round robin by fewest ladder matches (the anchor), then the
  least-played half of everyone else sorted nearest in rating. Recent tables
  are remembered so the same two do not keep meeting, and that memory is
  relaxed rather than enforced when everyone free has just played.
- **Format** is the mode's rated format with `ladder: true`, a 5 s clock and
  `holdMs` 1 s, so a hand nobody is watching does not pause four seconds.
  Everything else is the product format: 25 hands, 200 units, rated, stored,
  replayable. That is the point, because a human beating a level 3 bot should
  beat a number that was earned the same way theirs is.
- **Off under vitest** unless a test calls `configureLadder({enabled: true})`.
  `LADDER_ENABLED` and `LADDER_PAUSE_MS` are the knobs on the box.

Ladder matches are excluded from `/api/live` and from `/api/recent` unless
`?ladder=1`, **regardless of `POPULATION_PUBLIC`**: turning the population's
own visibility on does not put the backstage ladder on display, since it
exists to make ratings real rather than to be watched. `/api/bots` reports
`ladderMatches` per bot beside the per-mode ratings.

Proof that it does what it is for: `../../test/ladder.test.ts`'s skipped
`ladder proof`, run with `LADDER_PROOF=1 LADDER_PROOF_MATCHES=40` against its
own database, ended level 1 on 1328, level 2 on 1292, level 3 on 1558, level 4
on 1604 and level 5 on 1681. Five matches is not enough to say anything;
forty puts three hundred points between the ends.
