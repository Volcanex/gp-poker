/* A range is 1326 weights, one per two card combo, in the dense combo
   numbering from cards.ts. Zero means the hand is not there; anything above
   zero is a frequency, so a range can hold a mixed strategy rather than only a
   set of classes (which is the one thing @opentable/equity's Range cannot do,
   and the reason this package has its own).

   Ranges are built from the heuristic heads-up charts in @opentable/preflop:
   a spot's chart gives cumulative percentile regions over the 169 classes, and
   a region becomes the combos whose class falls inside it. The edges are
   tapered rather than sharp, which is what "mixed frequencies at the
   boundaries" means in practice and also stops a one percentile difference in
   the equity table flipping a whole class in or out. */

import { chartFor, handClass, percentileOf, regionsOf, spotFor, type DecisionAction, type Spot, type StackBucket } from '@opentable/preflop';
import { COMBO_HIGH, COMBO_LOW, NUM_COMBOS, cardOf, comboBlocked } from './cards.js';
import type { Card } from '@opentable/protocol';

export type Range = Float32Array;

// Percentile points either side of a chart boundary that get a partial
// weight. Two points is about one class wide in the middle of the ranking.
const TAPER = 4;

/* Every combo's percentile in the heads-up equity ranking, precomputed once.
   169 classes over 1326 combos, so this is a spread of a small table rather
   than a calculation. */
export const COMBO_PERCENTILE = new Float32Array(NUM_COMBOS);

for (let i = 0; i < NUM_COMBOS; i++) {
  const cards: [Card, Card] = [cardOf(COMBO_HIGH[i]), cardOf(COMBO_LOW[i])];
  COMBO_PERCENTILE[i] = percentileOf(handClass(cards));
}

export function emptyRange(): Range {
  return new Float32Array(NUM_COMBOS);
}

export function cloneRange(range: Range): Range {
  return new Float32Array(range);
}

export function regionWeight(p: number, lo: number, hi: number): number {
  let w = 1;
  if (lo > 0) w *= Math.max(0, Math.min(1, (p - lo) / TAPER + 0.5));
  if (hi < 100) w *= Math.max(0, Math.min(1, (hi - p) / TAPER + 0.5));
  return w;
}

/* Every combo whose class percentile sits in [lo, hi], tapered at any edge
   that is not the end of the ranking. */
export function rangeFromPercentiles(lo: number, hi: number): Range {
  const range = emptyRange();
  for (let i = 0; i < NUM_COMBOS; i++) range[i] = regionWeight(COMBO_PERCENTILE[i], lo, hi);
  return range;
}

/* The range a heads-up chart assigns to one action at one spot. `bb_vs_open`
   with 'passive' is "the hands the big blind calls an open with". */
export function chartRange(bucket: StackBucket, spot: Spot, action: DecisionAction): Range {
  const regions = regionsOf(chartFor(bucket, spot));
  const region = regions[action];
  if (!region) return emptyRange();
  return rangeFromPercentiles(region[0], region[1]);
}

/* The union of the actions a player could still hold after taking one of them,
   which is what an opponent's range is when we do not know which of two
   non-folding actions they took. Weights add and are capped at one. */
export function unionRange(...ranges: Range[]): Range {
  const out = emptyRange();
  for (const r of ranges) for (let i = 0; i < NUM_COMBOS; i++) out[i] = Math.min(1, out[i] + r[i]);
  return out;
}

export function blendRanges(a: Range, b: Range, weightB: number): Range {
  const out = emptyRange();
  const wa = 1 - weightB;
  for (let i = 0; i < NUM_COMBOS; i++) out[i] = wa * a[i] + weightB * b[i];
  return out;
}

/* Zeroes every combo that uses a card already on the board or in our own hand.
   Mutates, because a range is rebuilt per street and copying it again to do
   this is pure waste. */
export function removeBlocked(range: Range, dead: number[]): Range {
  const mask = deadMaskOf(dead);
  for (let i = 0; i < NUM_COMBOS; i++) if (range[i] > 0 && comboBlocked(i, mask)) range[i] = 0;
  return range;
}

function deadMaskOf(cards: number[]): [number, number] {
  let lo = 0;
  let hi = 0;
  for (const c of cards) {
    if (c < 26) lo |= 1 << c;
    else hi |= 1 << (c - 26);
  }
  return [lo, hi];
}

export function rangeWeight(range: Range): number {
  let total = 0;
  for (let i = 0; i < NUM_COMBOS; i++) total += range[i];
  return total;
}

export function scaleRange(range: Range, factor: number): Range {
  for (let i = 0; i < NUM_COMBOS; i++) range[i] *= factor;
  return range;
}

/* Widen a range towards "any two cards" by `amount`, so a line we cannot
   explain never leaves an opponent holding nothing. A range that has been
   filtered to zero everywhere comes back as the flat prior rather than as an
   impossible hand. */
export function widen(range: Range, amount: number, dead: number[]): Range {
  const mask = deadMaskOf(dead);
  let any = false;
  for (let i = 0; i < NUM_COMBOS; i++) {
    if (comboBlocked(i, mask)) {
      range[i] = 0;
      continue;
    }
    range[i] = range[i] * (1 - amount) + amount;
    if (range[i] > 0) any = true;
  }
  if (!any) for (let i = 0; i < NUM_COMBOS; i++) range[i] = comboBlocked(i, mask) ? 0 : 1;
  return range;
}

/* The heads-up preflop spot a hand is at, in the terms the charts are indexed
   by, or null if the line has run past the four spots they model. */
export function headsUpSpot(bucket: StackBucket, position: 'sb' | 'bb', raiseCount: number): Spot | null {
  return spotFor(bucket, position, raiseCount);
}
