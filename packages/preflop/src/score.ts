/* EV-lost scoring. A hand's percentile in the equity ranking (from equity.ts)
   falls into one of a spot's chart regions (aggr/passive/fold); that region's
   action is "best". When the actual action differs, evLost is proportional to
   how many percentile points the hand sits outside the region that action
   owns (0 if it's the region it landed in, since then the action was best).

   The constant below is anchored on the deep sb_open chart (aggr 80,
   passive 90): folding AA (percentile 0) there needs to cross the whole gap
   to fold's region, which starts at 90, so 90 * EV_PER_PERCENTILE = 5 bb.
   The same constant makes a hand one percentile outside a raise-or-fold
   boundary (no passive band, e.g. push charts) cost about 1/18 ~ 0.06 bb.
   Capped at 8 bb as a safety ceiling. */

import { percentileOf } from './equity.js';
import { chartFor, regionsOf } from './charts.js';
import type { DecisionAction, Spot, StackBucket } from './types.js';

export const EV_PER_PERCENTILE = 1 / 18;
export const MAX_EV_LOST = 8;

export interface ScoreInput {
  spot: Spot;
  bucket: StackBucket;
  hand: string;
  action: DecisionAction;
}

export interface ScoreResult {
  best: DecisionAction;
  evLost: number;
  inRange: boolean;
}

const ACTIONS: DecisionAction[] = ['aggr', 'passive', 'fold'];

export function scoreDecision(input: ScoreInput): ScoreResult {
  const chart = chartFor(input.bucket, input.spot);
  const regions = regionsOf(chart);
  const p = percentileOf(input.hand);

  const best = ACTIONS.find((a) => {
    const r = regions[a];
    return r && p >= r[0] && p <= r[1];
  }) ?? 'fold';

  if (input.action === best) return { best, evLost: 0, inRange: true };

  // The chosen action may not own a region at all in a two-action spot
  // (e.g. 'passive' in a raise-or-fold push chart). Fall back to the nearest
  // defined boundary so the score degrades gracefully instead of throwing.
  const region = regions[input.action] ?? (() => {
    const boundary = chart.aggr ?? chart.passive ?? 0;
    return [boundary, boundary] as [number, number];
  })();

  const distance = p < region[0] ? region[0] - p : p > region[1] ? p - region[1] : 0;
  const evLost = Math.min(distance * EV_PER_PERCENTILE, MAX_EV_LOST);
  return { best, evLost, inRange: false };
}
