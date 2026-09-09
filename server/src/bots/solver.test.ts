import { describe, expect, it } from 'vitest';
import { formatFor, type BotLevel } from '@opentable/protocol';
import { budgetFor, thinkingTier } from './solver.js';
import { brainForLevel, mulberry32, playHand, seedFrom } from './simulate.js';

/* Both thinking tiers through the engine. The benchmark says how well they
   play; this says they play at all, which is a different question and the one
   a change to the solver is most likely to break: an action the view did not
   offer, an amount outside the legal window, or a hand that never ends.

   The budget is tiny on purpose. What is being tested is that every decision
   comes back legal and that a short budget falls back rather than acting on a
   solve that has not converged, not that the solve is any good. */

const FORMAT = formatFor('heads-up', false);
const BUDGET_MS = 25;

describe('the thinking tiers', () => {
  it.each([
    ['regular', 6],
    ['solver', 7],
  ] as const)('plays legal poker as the %s tier at every stack depth', async (_tier, level) => {
    const thinking = brainForLevel(level as BotLevel, BUDGET_MS);
    const sharp = brainForLevel(5);
    const rng = mulberry32(31);
    for (const stack of [24, 60, 200]) {
      for (let d = 0; d < 12; d++) {
        const seed = seedFrom(rng);
        for (const button of [0, 1]) {
          const outcome = await playHand(
            [thinking, sharp],
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
    // be a sharp tier decision rather than an exception.
    const solver = brainForLevel(7, BUDGET_MS);
    const rng = mulberry32(17);
    const outcome = await playHand(
      [solver, brainForLevel(4 as BotLevel)],
      { stack: 60, sb: 1, bb: 2, button: 0, seed: seedFrom(rng) },
      { format: formatFor('six-max', false), matchId: 'test6', handNumber: 1 },
      mulberry32(9)
    );
    expect(outcome.chips[0] + outcome.chips[1]).toBe(0);
  }, 30_000);

  it('budgets a quarter of the clock, capped per tier, and lower on the ladder', () => {
    expect(budgetFor(300, 'solver')).toBe(75);
    expect(budgetFor(20_000, 'solver')).toBe(1500);
    expect(budgetFor(1, 'solver')).toBe(1);
    // The regular tier solves one street and is capped far shorter for it.
    expect(budgetFor(20_000, 'regular')).toBe(400);
    expect(budgetFor(1200, 'regular')).toBe(300);
    // Nobody is watching a ladder match and it runs around the clock.
    expect(budgetFor(20_000, 'solver', true)).toBe(250);
    expect(budgetFor(300, 'solver', true)).toBe(75);
  });

  it('maps every level to a tier and only two of them think', () => {
    expect(thinkingTier(5)).toBeNull();
    expect(thinkingTier(6)).toBe('regular');
    expect(thinkingTier(7)).toBe('solver');
  });
});
