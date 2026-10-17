# server/scripts

Measurement, not operations. The ops scripts (deploy, backup, restore) are the
shell ones at the repo root in `scripts/`; these are TypeScript and are run by
hand when a number needs producing.

- `bench-bots.ts`: how much one bot level beats another, in big blinds per
  hundred hands with a standard error, plus the decision latency distribution.

  ```
  npx tsx server/scripts/bench-bots.ts
  BOT_BENCH_DEALS=400 BOT_BENCH_BUDGET_MS=500 BOT_BENCH_STACKS=100 \
    npx tsx server/scripts/bench-bots.ts
  ```

  It exists because level 6's claim is a size and not a fact:
  `src/bots/levels.test.ts` proves the levels are ordered, and ordering is a
  test that passes or fails, but "beats level 5" is a number that needs an
  interval around it. Level 6 also thinks for a real fraction of a second per
  decision, which is not something a unit test should be doing.

  The design is the ordering test's, and both run on `src/bots/simulate.ts` so
  they measure the same thing the same way: every deal played four times, both
  seatings and both buttons, the two seatings sharing a decision stream from
  the same starting state, so identical strategies cancel to exactly zero. One
  sample is one (deal, button) pair, which is two hands.

- `bench-slumbot.ts`: level 6 against Slumbot, over its public HTTP API. A
  yardstick and **never a dependency**: nothing in the product talks to it, and
  this script is expected to stop working the day they change the protocol.

  ```
  SLUMBOT_HANDS=400 SLUMBOT_BUDGET_MS=600 npx tsx server/scripts/bench-slumbot.ts
  ```

  Two things about the protocol are worth writing down because they were
  measured rather than read. An action string's `b<n>` is that player's total
  contribution **on that street**, which is exactly what this codebase calls a
  raise-to, so no conversion is needed. And passing the previous hand's token
  back to `/api/new_hand` is what keeps the session, which is what makes the
  seats alternate: without it every hand is dealt from the big blind and the
  result measures how expensive the big blind is rather than how well the bot
  plays. `client_pos` 1 means we are the button.

  Four hundred hands is nowhere near enough to measure a win rate heads-up: the
  standard error at that sample is about a hundred big blinds per hundred
  hands. It is enough to say the bot is not being destroyed and that it never
  sends an action Slumbot rejects, and both of those are worth knowing.

- `hands-retention.ts`: the one operations script here, because it shares its
  rules with the server's sweep (`src/retention.ts`, documented in
  `src/CLAUDE.md`). Needs `--dry-run` or `--apply`; a dry run's connection is
  read-only at the server, so it cannot write.

  ```
  npx tsx server/scripts/hands-retention.ts --dry-run --days 14
  npx tsx server/scripts/hands-retention.ts --apply --days 14 --max-batches 50
  ```

## Gotchas
`BOT_BENCH_BUDGET_MS` defaults well below the 1500ms a live table gives the
solver tier, because a run long enough to say anything at 1500ms takes hours. A
smaller budget makes a thinking tier worse, so every number it prints is a
floor. Say which budget a number came from whenever you quote one.

By default it gives **both sides the same budget**, which is the controlled
comparison: it asks which allocation of the same processor plays better, and
between the regular and solver tiers that is the whole question. Set
`BOT_BENCH_PRODUCTION_BUDGETS=1` to give each tier the budget a live match
gives it instead, which asks the different question of which one wins at a real
table. Both are worth having and they are not the same number.

The budget is spent in **processor time**, not wall clock, because this box is
shared: a wall clock budget while three other things are running measures the
other three things. Live play is the other way round, so the server's runner is
not this one.
