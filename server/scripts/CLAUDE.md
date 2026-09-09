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

## Gotcha
`BOT_BENCH_BUDGET_MS` defaults well below the 1500ms a live table gives level
6, because a run long enough to say anything at 1500ms takes hours. A smaller
budget makes level 6 worse, so every number it prints is a floor. Say which
budget a number came from whenever you quote one.
