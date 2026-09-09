import { describe, expect, it } from 'vitest';
import { formatFor, type BotLevel } from '@opentable/protocol';
import { budgetFor } from './solver.js';
import { brainForLevel, mulberry32, playHand, seedFrom } from './simulate.js';

/* Level 6 through the engine. The benchmark says how well it plays; this says
   it plays at all, which is a different question and the one a change to the
   solver is most likely to break: an action the view did not offer, an amount
   outside the legal window, or a hand that never ends.

   The budget is tiny on purpose. What is being tested is that every decision
   comes back legal and that a short budget falls back rather than acting on a
   solve that has not converged, not that the solve is any good. */

const FORMAT = formatFor('heads-up', false);
const BUDGET_MS = 25;

describe('level 6', () => {
  it('plays legal poker to the end of a hand at every stack depth', async () => {
    const solver = brainForLevel(6, BUDGET_MS);
    const sharp = brainForLevel(5);
    const rng = mulberry32(31);
    for (const stack of [24, 60, 200]) {
      for (let d = 0; d < 12; d++) {
        const seed = seedFrom(rng);
        for (const button of [0, 1]) {
          const outcome = await playHand(
            [solver, sharp],
            { stack, sb: 1, bb: 2, button, seed },
            { format: FORMAT, matchId: 'test', handNumber: d + 1 },
            mulberry32(5000 + d)
          );
          // playHand throws if a hand does not finish, and the engine throws on
          // an illegal action, so reaching here is the assertion. The chips
          // still have to add up.
          expect(outcome.chips[0] + outcome.chips[1]).toBe(0);
        }
      }
    }
  }, 120_000);

  it('is heads-up only and hands a multiway street back', async () => {
    // Three seats is not something the solver plays, so what comes out has to
    // be a level 5 decision rather than an exception.
    const solver = brainForLevel(6, BUDGET_MS);
    const rng = mulberry32(17);
    const outcome = await playHand(
      [solver, brainForLevel(4 as BotLevel)],
      { stack: 60, sb: 1, bb: 2, button: 0, seed: seedFrom(rng) },
      { format: formatFor('six-max', false), matchId: 'test6', handNumber: 1 },
      mulberry32(9)
    );
    expect(outcome.chips[0] + outcome.chips[1]).toBe(0);
  }, 30_000);

  it('budgets a quarter of the clock, capped, and far lower on the ladder', () => {
    expect(budgetFor(300)).toBe(75);
    expect(budgetFor(20_000)).toBe(1500);
    expect(budgetFor(1)).toBe(1);
    // Nobody is watching a ladder match and it runs around the clock.
    expect(budgetFor(20_000, true)).toBe(250);
    expect(budgetFor(300, true)).toBe(75);
  });
});
