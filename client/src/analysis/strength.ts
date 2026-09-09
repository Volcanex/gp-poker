/* The strength meter's arithmetic: which stud a hand lights, which studs a
   draw is aiming at, and what a preflop holding is called before there is a
   made hand to name. Pure, so the strip's studs can be tested without a
   worker. The category itself comes from the worker's `handName`; nothing here
   evaluates a card. */

import type { DrawName, HandCategory } from '@opentable/equity';
import type { Card } from './protocol.ts';

/* Weakest first, one stud each, left to right. */
export const STUDS: readonly HandCategory[] = [
  'high card',
  'pair',
  'two pair',
  'three of a kind',
  'straight',
  'flush',
  'full house',
  'four of a kind',
  'straight flush',
];

export function studOf(category: HandCategory): number {
  return STUDS.indexOf(category);
}

/* The stud a draw completes on. Overcards pair, a straight draw straightens,
   a flush draw flushes. A backdoor draw is a name and not an out, so it aims
   at nothing here, which matches the outs cell headlining no number for it. */
const LANDS: Partial<Record<DrawName, HandCategory>> = {
  'two overcards': 'pair',
  'gutshot': 'straight',
  'open-ended straight draw': 'straight',
  'flush draw': 'flush',
};

/* Studs the live draws would light, above the hand as it stands. A draw that
   lands on or below the made hand is not worth marking: a flush draw on a
   full house improves nothing the meter can show. Sorted, deduplicated. */
export function drawTargets(draws: readonly DrawName[], current: HandCategory | null): number[] {
  const floor = current ? studOf(current) : -1;
  const out = new Set<number>();
  for (const draw of draws) {
    const lands = LANDS[draw];
    if (!lands) continue;
    const at = studOf(lands);
    if (at > floor) out.add(at);
  }
  return [...out].sort((a, b) => a - b);
}

const RANKS = 'AKQJT98765432';
const PLURAL: Record<string, string> = {
  A: 'aces', K: 'kings', Q: 'queens', J: 'jacks', T: 'tens', 9: 'nines', 8: 'eights',
  7: 'sevens', 6: 'sixes', 5: 'fives', 4: 'fours', 3: 'threes', 2: 'twos',
};

/* What two cards are called before the flop, in the words a player uses:
   "Pocket kings", "Suited connectors", "Suited one gapper", "Connectors",
   "Suited", "Offsuit". The ace connects both ways, so ace king and ace two
   are both connectors. This is the only naming the strip does on its own;
   from the flop on the worker names the hand. */
export function preflopWords(hole: readonly [Card, Card]): string {
  const [a, b] = hole;
  const ra = RANKS.indexOf(a[0]);
  const rb = RANKS.indexOf(b[0]);
  if (ra === rb) return `Pocket ${PLURAL[a[0]]}`;
  const suited = a[1] === b[1];
  const [hi, lo] = ra < rb ? [ra, rb] : [rb, ra];
  const gap = Math.min(lo - hi, hi === 0 ? RANKS.length - lo : Infinity);
  if (gap === 1) return suited ? 'Suited connectors' : 'Connectors';
  if (gap === 2) return suited ? 'Suited one gapper' : 'One gapper';
  return suited ? 'Suited' : 'Offsuit';
}
