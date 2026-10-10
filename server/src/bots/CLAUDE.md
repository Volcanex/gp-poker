# bots

The bot population, one bot's message loop, the persona layer, and the pure
decision function.

## A bot plays a tier, not a number

`BotTier` and `LEVEL_TIER` live in the protocol. **Nothing in this directory
branches on a level number**: `decide` dispatches on the tier, the
budget table is keyed by tier, and `THINKING_SEATS` in `population-roster.ts`
is the one place that says which roster indexes get one. That is what makes
the coming renumbering an edit to `LEVEL_TIER` and three numbers rather than a
search through five files for integer comparisons.

Not to be confused with `ActivityTier` in `population-roster.ts`, which is how
much a bot plays (grinder, regular, casual) and has nothing to do with how well
it plays. The word `regular` means different things in the two, which is worth
knowing before grepping for it.

## Shape
- `strategy.ts` - `decide(view, rng, level, persona)`. Pure: same `TableView`
  a browser gets in, one legal action out. No socket, no room, no database,
  so every branch is reachable from a synthetic view. The five instant tiers
  only, and it maps a thinking tier onto `sharp` so a view that reaches it
  cannot play the default tier by accident.
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
- `solver.ts` - the two tiers that cannot be a pure function, because they
  need state across a hand and a clock. `decideSolver(userId, view, rng,
  level)` returns an action, or null when this process is already thinking as
  hard as it is willing to.
- `simulate.ts` - bots against each other through the engine, with no
  database, room or socket. The level ordering test and
  `../../scripts/bench-bots.ts` both run on it, so they measure the same thing
  the same way.
- `pacing.ts` - pure: which think-time range applies (`thinkRange`) and where
  inside it a real decision lands (`spotWeight`, `spotThinkMs`). See below.
- `player.ts` - `BotPlayer`. Holds a level and a persona, thinks on a timer
  capped against the decision clock, answers through the ordinary client
  router, and says the odd line through the same path.
- `index.ts` - turns the population into database rows and live
  `BotPlayer`s, and answers who is free, who is queued, whether a match has a
  human in it (`matchHasHuman`), and the summary `/api/bots` serves.

## Thinking time is a function of the format, the table and the spot

`pacing.ts` owns this, pure throughout: no clock, no rng seeded inside it,
every branch reachable from a plain object. `player.ts`'s `think()` is the
only place real time runs.

One `BotPlayer` instance is loaded per bot account for the life of the
process and plays a rated queue fill, a practice table and a ladder match one
after another, so the pacing cannot be fixed at construction:
`thinkRange(format, trivial, humanPresent)` is asked fresh on every decision.
Three ranges, each with a "trivial" half (a check, a call or fold that costs
nothing) and a "real decision" half:

- **Fast** (100-400ms / 600-1800ms): a fast-speed table, or **any table with
  no human at it**, whatever its format says.
- **Standard** (300-900ms / 1200-3400ms): a standard-speed table with a human
  present. A twenty second clock and blinds that sit still read as a real
  table, and a bot answering in under a second is the tell, whoever is
  playing or spectating.
- **Practice** (200-800ms / 1400-3200ms): a practice table, which is always a
  person against bots. Slower than standard on purpose: fast enough not to be
  dull, slow enough that a hand reads as something happening.

**`humanPresent` decides before the format gets a say.** A table with nobody
real at it plays at the fast ranges regardless of its speed or its format,
because pacing a table nobody is watching for a spectator who is not there
costs throughput for nothing. This used to be a check for `format.ladder`
specifically, which was really always a proxy for "nobody is watching"; the
real fact now decides directly, which is what closed the actual gap. The
ladder is one bot-only table. It was never the only one: the population's
own bots search the ordinary queue and pair with each other through the same
algorithm a human uses whenever nobody wants the same table
(`../matchmaking.ts`'s "People first"), and a **standard-speed** pairing like
that has no `ladder` flag on its format at all. Before `humanPresent`
existed, a table like that paced itself for a spectator who was never coming,
which is exactly the kind of thing that quietly halves the rating pool's
throughput on a near-empty site: most bot-vs-bot matches are the ordinary
queue's fallback, not the ladder's.

**Asking is the only option, because reading the view lies.**
`humanPresent` cannot be read off the seats a decision's own `TableView`
carries: `shownAsBot` (`config.ts`) masks every population bot's `bot` field
to `false` once the population is public, so the room reads as people to
everyone in it, bots included. `bots/index.ts`'s `matchHasHuman(matchId)` is
the one place that can answer for real, because `players` there is the
actual loaded roster rather than a wire field anything can mask: it checks
the match's `playerIds` against that roster and answers whether any of them
is not on it. `player.ts` never imports `index.ts` to ask it (that would be
a bot player module reaching back up to the thing that constructs bot
players, the same shape of coupling `dispatch` was already injected to avoid),
so `humanAtMatch` is injected into `BotPlayer`'s constructor exactly the
way `dispatch` is, and `index.ts` passes `matchHasHuman` there when it builds
each bot. A test constructing a `BotPlayer` directly and supplying nothing
gets `() => true`, the paced-for-a-person default, not the fast one.

**Inside the "real decision" half of a standard or fast table's range, the
delay is a function of the spot** (`spotWeight`, `spotThinkMs`), not a second
uniform roll across the same numbers regardless of what is being decided. A
street weight (preflop lowest, river highest) and a stake weight (a call or
fold judged against what is left in the seat's own stack, a bet or raise
judged against where its size sits between the legal minimum and an all-in)
combine into a 0-1 read of how big the spot looks, which picks a point inside
the range; jitter of up to 30% of the range's own width sits on top of that
point, so six bots weighing similar spots at the same table do not land on
the same instant. A river shove reads near the top of the range; a preflop
fold to a min-raise reads near the bottom; a flop continuation bet sits
somewhere between. The trivial half is still a plain uniform roll across its
own (already short) range: there is nothing to weigh in a decision that costs
nothing.

**Practice is the one range spot-weighting never touches**, trivial or not.
It was asked for on standard tables, which is where "a bot answering in under
a second is the tell" actually lives; practice is a new visitor's likely
first look at the site, and pushing the slower half of an already generous
1400-3200ms range up further for the biggest spots is the wrong direction to
move a page somebody might bounce off before they have played a hand. A
practice decision keeps the plain uniform roll it always had.

Every range is still capped against a quarter of `format.clockMs`, so a short
test clock is unaffected either way, and pacing can never eat into the time a
bot is actually given to act.

## Seven levels, five tiers in one function
`decide` takes a level, **default 5** (`DEFAULT_BOT_LEVEL`). It was 4, which is
the bot that existed before levels did, and which most people beat by their
second session; 5 is the hardest tier that is still one pure function of the
view, so the default costs exactly the same processor as the one it replaced.
Every level reuses the same `Ctx`, the same `handStrength` and the same action
helpers (`aggressive`, `passive`, `giveUp`), and differs only in named
constants and which rule it reaches for.

- 1 and 2 replace the chart read with a percentile threshold and lose by
  calling too much; 3 is the same read but price-aware and too passive.
- 5 is level 4 plus semi-bluffs, a continuation bet, board-aware sizing,
  a thin river value bet, an occasional 3-bet bluff, and a margin on its calls.

**`handStrength` answers against one opponent, and `vsField` is what makes
that true multiway.** The number is the fraction of remaining two-card
holdings this hand beats; against n opponents the hand has to beat all of
them, so the tiers that read it (`solid` and `sharp`) raise it to the power of
the field first. Top pair is 0.82 against one and 0.37 against five, which is
what it is worth, and stacking off with it five handed was the single largest
leak either tier had. `bluffChance` does the same job for the bluffing spots,
decaying each one by 0.55 per extra opponent, because a bluff has to get
through everybody. **Heads-up the exponent is 1 and the decay is 1**, so the
heads-up game is untouched by both and the ordering test does not move.

Measured on `simulate.ts` six handed, new against old at the same level over
36k hands a side: **level 4 +277 bb/100, level 5 +235 bb/100** (SE ~46). The
preflop half of that is `preflopMultiway` no longer using one threshold to
cold-call an open and to call a raise (`CALL_VS_RAISE`, and both scaled by
`lateness` the way the raise threshold always was).

`decide` maps a thinking tier onto `sharp` rather than falling through to its
default branch, so a view that reaches the pure function with a tier it does
not implement plays the nearest thing rather than silently playing `solid`.

**Level 5 bluffs less than its description suggests, on purpose.** Every level
below it calls a bet down to about a quarter of the pot in equity, so against
the field it actually plays there is almost no folding equity to win: the
money is in value bets and in not paying off. Turning the bluff frequencies up
makes level 5 lose to level 2. This is tuned against these opponents, not
against a solver.

The same measurement says so twice over. Heads-up, level 5 against itself over
6k hands a side: raising `SHARP_CBET_CHANCE` from 0.3 to 0.45 was worth
+2 bb/100 against an SE of 13, i.e. nothing, and extending the flop
continuation bet to a turn barrel was **-5**. What did pay was the opposite
direction on value: `SHARP_RIVER_VALUE` 0.7 -> **0.78** is +32, +45 and +22
bb/100 on three seeds. Thinner river value betting is actively bad here
(0.62 measured **-112**), because the hands that call are the ones that beat
it. Before tuning a constant in this file, measure it; the intuition is
usually wrong about which direction is the improvement.

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

**They run on the main thread, in slices, and not in a worker.** A worker was
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

**Neither is multiway.** The solver is heads-up. A six-max hand gets the sharp
tier until it is heads-up postflop, at which point it is solved like any
other.

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

**The two rows involving the regular tier are not measured yet.** It was built
on 2026-09-09 on a box already saturated by other work, which gave the
benchmark about a quarter of one core, and a run at the bar the other rows were
held to needs roughly ten minutes of processor per matchup. Produce them on a
quiet box with:

```
BOT_BENCH_DEALS=120 BOT_BENCH_STACKS=100,30 BOT_BENCH_PAIRS=6v5,7v6 \
  npx tsx server/scripts/bench-bots.ts
```

Until then the honest statement about the regular tier is that it plays legal
poker at every stack depth, solves the river and nothing else (measured: three
decisions in four never reach a solve), and deviates from the sharp tier only
where a statistic says to. Whether that is worth big blinds is unmeasured.

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
`LEVEL_CYCLE[i % 10]` (`levelForIndex`), so levels cycle rather than sitting
in blocks.

**The population is the top three synchronous tiers only**, weighted to the
top: half sharp, a third solid, the rest tight. It used to be `(i % 5) + 1`,
an even fifth on each tier, which put nearly half the bots anybody ever met on
`station` or `loose` - the calling station, and the one that raises only the
nuts. That is what "the bots are bad" was describing, and it was a fair
reading of a queue filled that way. The weak tiers have not gone anywhere:
they are the practice ladder's, where a beginner picks them on purpose. They
are simply not sat in front of anybody by this roster.

`ensureBotUser` updates `bot_level` on an existing row whenever the roster
disagrees with it, so changing `LEVEL_CYCLE` re-levels the live population at
the next boot. **Their ratings do not follow.** A bot that spent months
earning a rating as a calling station keeps it and now plays sharp, so the
ladder is wrong until the population has played itself back into shape. That
is a deliberate trade against resetting a live rating table; if it ever needs
forcing, it is a truncate of `ratings` for `bot = true` and not a code
change.

**Except for three seats.** `THINKING_SEATS` puts indexes 117 and 118 on the
regular tier and 119 on the solver tier, so a ranked six-max table sometimes
seats a bot that thinks. Three out of a hundred and twenty, because a solver
decision is a second of processor and this box has four cores that are not
only ours: one solver seat, two regulars. They are keyed by index rather than
derived so that they stay rare and countable, leave every other index on the
cycle it has always been on, and survive the population growing. They sit at
the end of the default population, so a smaller one (a test's fifteen) has
none at all and pays nothing for them. A level is read after every other field
is drawn, so which seats think moves nobody's name, country or schedule.

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

The seven archetypes are flavour on top of the instant tiers, not another
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
  message drives. `rated` is `Math.random() < 0.75`: three tables in four are
  rated. It used to ask `rankedUnlocked` first, so that a bot cleared the same
  one-casual-match gate a human did; that gate was removed on 2026-09-21 and
  the roll is now the only thing deciding.
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
  Everything else is the product format: 200 units, no hand cap, rated, stored,
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
