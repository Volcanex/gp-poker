# bots

The bot roster, one bot's message loop, and the pure decision function.

## Shape
- `strategy.ts` - `decide(view, rng, level)`. Pure: same `TableView` a browser
  gets in, one legal action out. No socket, no room, no database, so every
  branch is reachable from a synthetic view.
- `player.ts` - `BotPlayer`. Holds a level, thinks on a timer capped against
  the decision clock, and answers through the ordinary client router.
- `index.ts` - the roster: names, levels, who is free, and the summary
  `/api/bots` serves.

## Five levels, not five brains
`decide` takes a level, default 4. **Level 4 is the bot that existed before
levels did, byte for byte**: `server/test/strategy.test.ts` pins it and must
keep passing untouched. Every other level reuses the same `Ctx`, the same
`handStrength` and the same action helpers (`aggressive`, `passive`,
`giveUp`), and differs only in named constants and which rule it reaches for.

- 1 and 2 replace the chart read with a percentile threshold and lose by
  calling too much; 3 is the same read but price-aware and too passive.
- 5 is level 4 plus semi-bluffs, a continuation bet, board-aware sizing,
  thinner river value, an occasional 3-bet bluff, and a margin on its calls.

**Level 5 bluffs less than its description suggests, on purpose.** Every level
below it calls a bet down to about a quarter of the pot in equity, so against
the field it actually plays there is almost no folding equity to win: the
money is in value bets and in not paying off. Turning the bluff frequencies up
makes level 5 lose to level 2. This is tuned against these opponents, not
against a solver.

The ordering is proved, not asserted by hand. `levels.test.ts` plays a seeded
round robin through the engine and reads chips won. It is worth knowing why it
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

## The roster
Fifteen bots, three per level, generated from the fixed seed `opentable-bots`.
The generator walks the same sequence every time, so **growing the roster only
appends**: the eight bots that existed before levels kept their names, ratings
and match histories. Roster index `i` plays at `(i % 5) + 1`, so levels cycle
rather than sitting in blocks and the first accounts ever created are spread
across all five.

`users.bot_level` is re-asserted from the roster on every boot (`ensureBots` →
`ensureBotUser`), which keeps the code the source of truth for who plays how
rather than whichever row was written first. `config.botCount` must stay at 15
or a level ends up with nobody loaded and cannot be practised against.

## Availability
`availableBots` fills the ordinary rated and casual queues, nearest in rating
first, and is untouched by levels. `availableBotsAtLevel` fills a practice
table: the level asked for first, then outwards a level at a time (L-1, L+1,
L-2, ...). Three bots per level cannot seat a six-max table from one level, so
**spreading is the normal case, not the fallback**. Both ask the room whether
it is still `active` rather than whether it exists, because a finished room
lingers for a minute.

Bots are excluded from the leaderboard but their rated matches move their
ratings, which is what `/api/bots` reports. Practice matches never do.
