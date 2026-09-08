/* The baseline preflop chart's client-facing shape: which bucket/spot
   combinations the puzzle generator offers, and the plain-language copy for
   each. The chart itself, its regions and its EV-lost formula live in
   @opentable/preflop, safe to import here now that it reads its two JSON
   files with static imports rather than node:fs. */

export {
  bucketFor,
  chartFor,
  EV_PER_PERCENTILE,
  MAX_EV_LOST,
  percentileOf,
  rankedHands,
  regionsOf,
  scoreDecision,
  TOTAL_HANDS,
} from '@opentable/preflop';
export type {
  ChartEntry,
  DecisionAction as Action,
  Region,
  ScoreResult,
  Spot,
  StackBucket as Bucket,
} from '@opentable/preflop';

import { regionsOf } from '@opentable/preflop';
import type { ChartEntry, DecisionAction as Action, Spot, StackBucket as Bucket } from '@opentable/preflop';

const ACTIONS: Action[] = ['aggr', 'passive', 'fold'];

/* Which actions a spot can be answered with, in the order they are offered:
   the regions the chart defines, plus fold, which always exists. */
export function actionsFor(chart: ChartEntry): Action[] {
  const regions = regionsOf(chart);
  return ACTIONS.filter((a) => regions[a] !== undefined);
}

export const BUCKETS: Bucket[] = ['deep', 'mid', 'short', 'push'];

/* The spots each bucket has a chart for. Push stacks are a two spot world:
   shove or fold, then call or fold. */
export const SPOTS_BY_BUCKET: Record<Bucket, Spot[]> = {
  deep: ['sb_open', 'bb_vs_open', 'sb_vs_3bet', 'bb_vs_4bet'],
  mid: ['sb_open', 'bb_vs_open', 'sb_vs_3bet', 'bb_vs_4bet'],
  short: ['sb_open', 'bb_vs_open', 'sb_vs_3bet', 'bb_vs_4bet'],
  push: ['sb_push', 'bb_vs_push'],
};

export const BUCKET_WORDS: Record<Bucket, string> = {
  deep: 'deep stacks',
  mid: 'a mid stack',
  short: 'a short stack',
  push: 'push or fold',
};

/* The same words to open a line with, the way `stakeName` opens one. */
export function bucketName(bucket: Bucket): string {
  const words = BUCKET_WORDS[bucket];
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/* What the player is being asked, in the words the table would use. The
   aggressive action is a raise everywhere except a push stack, where it is the
   whole stack, and the passive action is a limp only when nobody has raised. */
export const SPOT_COPY: Record<Spot, { position: 'Small blind' | 'Big blind'; question: string; labels: Record<Action, string> }> = {
  sb_open: {
    position: 'Small blind',
    question: 'You are on the button, first to act before the flop.',
    labels: { aggr: 'Raise', passive: 'Limp', fold: 'Fold' },
  },
  bb_vs_open: {
    position: 'Big blind',
    question: 'The small blind has raised and it is on you.',
    labels: { aggr: 'Reraise', passive: 'Call', fold: 'Fold' },
  },
  sb_vs_3bet: {
    position: 'Small blind',
    question: 'You raised, the big blind reraised, and it is back on you.',
    labels: { aggr: 'Four bet', passive: 'Call', fold: 'Fold' },
  },
  bb_vs_4bet: {
    position: 'Big blind',
    question: 'You reraised, the small blind four bet, and it is back on you.',
    labels: { aggr: 'Five bet', passive: 'Call', fold: 'Fold' },
  },
  sb_push: {
    position: 'Small blind',
    question: 'Stacks are short enough that the only raise worth making is all of it.',
    labels: { aggr: 'Push', passive: 'Call', fold: 'Fold' },
  },
  bb_vs_push: {
    position: 'Big blind',
    question: 'The small blind has moved all in and it is on you.',
    labels: { aggr: 'Push', passive: 'Call', fold: 'Fold' },
  },
};

export function labelFor(spot: Spot, action: Action): string {
  return SPOT_COPY[spot].labels[action];
}
