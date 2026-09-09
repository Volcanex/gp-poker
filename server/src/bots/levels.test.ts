import { describe, expect, it } from 'vitest';
import { formatFor } from '@opentable/protocol';
import type { BotLevel } from '@opentable/protocol';
import { createHand } from '@opentable/engine';
import { decide } from './strategy.js';
import { brainForLevel, mulberry32, playHand, seedFrom, viewOf } from './simulate.js';

/* Proof that the levels are ordered. Nothing here talks to a database, a room
   or a socket: `simulate.ts` deals hands with the engine, builds the same
   TableView a client would see for whoever is to act, asks that seat's level
   for an action and applies it. What comes out is chips won.

   Two things keep the sample honest at a size that still runs in seconds.
   Every pair of levels plays every other pair (a round robin), so no level's
   total is one lucky matchup; and every deal is played twice with the seats
   swapped, so both levels play the same two hands from the same seat and a run
   of aces cancels out instead of deciding the result. Stacks reset to the same
   number every hand, which measures the strategy rather than who happened to
   bust first.

   Level 6 is not in here. It thinks for a real fraction of a second per
   decision, so a round robin against it is a benchmark script and not a unit
   test: `server/scripts/bench-bots.ts`. */

const LEVELS: BotLevel[] = [1, 2, 3, 4, 5];
const SEEDS = 500; // deals per pair, each played four times (see roundRobin)
// Thirty big blinds rather than the product's hundred. The strategies are the
// same either way, but the biggest pot a hand can lose is a third the size, so
// the gaps between neighbouring levels clear the noise in a sample this test
// can afford to run.
const STACK = 60;
const SB = 1;
const BB = 2;
const FORMAT = formatFor('heads-up', false);

const BRAINS = new Map<BotLevel, ReturnType<typeof brainForLevel>>(LEVELS.map((l) => [l, brainForLevel(l)]));

async function play(levels: [BotLevel, BotLevel], seed: string, button: number, rng: Parameters<typeof seedFrom>[0]) {
  const outcome = await playHand([BRAINS.get(levels[0])!, BRAINS.get(levels[1])!], { stack: STACK, sb: SB, bb: BB, button, seed }, { format: FORMAT }, rng);
  return outcome.chips;
}

async function roundRobin(): Promise<Map<BotLevel, number>> {
  const chips = new Map<BotLevel, number>(LEVELS.map((l) => [l, 0]));
  for (let a = 0; a < LEVELS.length; a++) {
    for (let b = a + 1; b < LEVELS.length; b++) {
      const [low, high] = [LEVELS[a], LEVELS[b]];
      // One rng per matchup, seeded from the pair, so a matchup's result does
      // not depend on how many hands the matchups before it happened to use.
      const rng = mulberry32(1000 * low + high);
      for (let s = 0; s < SEEDS; s++) {
        const seed = seedFrom(rng);
        // Every deal is played four times: both seatings, both buttons. Each
        // level therefore holds both hands from both positions, so a run of
        // aces or of dealer buttons cancels instead of deciding the result.
        // The two seatings of one deal share a decision stream from the same
        // starting state rather than taking two halves of one, which leaves
        // only the places where the levels actually decide differently. That
        // is the whole signal; without it the variance drowns the gaps.
        for (const button of [0, 1]) {
          const draw = 7_000_003 * low + 101 * high + 2 * s + button;
          const first = await play([low, high], seed, button, mulberry32(draw));
          const second = await play([high, low], seed, button, mulberry32(draw));
          chips.set(low, chips.get(low)! + first[0] + second[1]);
          chips.set(high, chips.get(high)! + first[1] + second[0]);
        }
      }
    }
  }
  return chips;
}

describe('bot levels', () => {
  it(
    'orders levels 1 to 5 by chips won in a seeded round robin',
    async () => {
      const chips = await roundRobin();
      const perLevel = LEVELS.map((l) => ({ level: l, chips: chips.get(l)! }));
      // Printed because a failure here is a tuning question, and the margins
      // are the answer to it.
      console.log(perLevel.map((p) => `L${p.level} ${p.chips > 0 ? '+' : ''}${p.chips}`).join('  '));

      // Every observed gap over a spread of seeds is at least twice this, and
      // the noise on one level's total is well under it: a level that has not
      // actually improved cannot clear it by luck.
      const margin = 1000;
      for (let i = 1; i < perLevel.length; i++) {
        expect(perLevel[i].chips).toBeGreaterThan(perLevel[i - 1].chips + margin);
      }
    },
    60_000
  );

  it('leaves level 4 as the default', () => {
    const state = createHand({
      seats: [
        { id: 's0', stack: STACK },
        { id: 's1', stack: STACK },
      ],
      button: 0,
      sb: SB,
      bb: BB,
      seed: seedFrom(mulberry32(11)),
    });
    const view = viewOf(state, state.toAct!, { format: FORMAT });
    expect(decide(view, () => 0.5)).toEqual(decide(view, () => 0.5, 4));
  });
});
