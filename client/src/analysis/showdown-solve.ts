/* Reading a showdown: what every hand is called, which five cards make it, and
   who wins the pot.

   This is the only puzzle code that touches the evaluator, so it is imported
   by worker.ts and by the unit tests and by nothing on the main thread. Same
   rule as draw-outs.ts next door: cross the worker boundary or leave phe's
   lookup table out of the bundle everybody loads. */

import { bestFive, handName } from '@opentable/equity';
import { winnersFrom } from '../puzzles/showdown.ts';
import type { ShowdownRead } from './protocol.ts';

export function solveShowdown(board: string[], hands: string[][]): ShowdownRead {
  const read = hands.map((hole) => {
    const cards = [...hole, ...board];
    const five = bestFive(cards);
    const named = handName(cards);
    return { name: named.name, category: named.category, strength: five.strength, five: five.cards };
  });
  return { hands: read, winners: winnersFrom(read.map((r) => r.strength)) };
}
