/* Dealing a preflop puzzle from the baseline heads-up charts.

   The chart is the answer, and the chart is heuristic. That is stated on the
   page rather than hidden: this puzzle grades a decision against the same
   baseline the accuracy score at the table grades against, and no further.

   Difficulty is the distance from the hand to the nearest boundary of the
   region it lands in. A hand deep inside the raising range is an easy raise; a
   hand a percentile from the fold cutoff is the one worth thinking about. The
   window shrinks as the streak grows, so a hard puzzle is a close one rather
   than an obscure one. */

import { ALL_CLASSES, HAND_GRID, RANKS } from '@opentable/equity/range';
import {
  BUCKETS,
  SPOTS_BY_BUCKET,
  actionsFor,
  chartFor,
  percentileOf,
  scoreDecision,
  type Action,
  type Bucket,
  type Spot,
} from './chart.ts';

export interface PreflopPuzzle {
  bucket: Bucket;
  spot: Spot;
  effectiveBb: number;
  hand: string;
  cards: [string, string];
  choices: Action[];
  best: Action;
}

/* Percentile points either side of a region boundary that a hand may sit in.
   Infinity is the whole ranking, which is where a player starts. */
const WINDOWS = [Infinity, 20, 12, 7, 4, 2];

export const MAX_LEVEL = WINDOWS.length - 1;

export function levelFor(streak: number): number {
  return Math.min(MAX_LEVEL, Math.max(0, Math.floor(streak / 2)));
}

export function windowFor(level: number): number {
  return WINDOWS[Math.min(MAX_LEVEL, Math.max(0, level))];
}

/* Effective stacks that land in each bucket, mirroring bucketFor's cutoffs.
   The number is shown to the player, so it has to be one a table could
   actually hold rather than the name of a band. */
const DEPTHS: Record<Bucket, [number, number]> = {
  deep: [60, 100],
  mid: [25, 59],
  short: [12, 24],
  push: [5, 11],
};

function choose<T>(items: T[], random: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}

/* How far a hand sits from the nearest cutoff in the chart. A hand exactly on
   a boundary is zero, and the ends of the ranking are measured against the
   cutoffs rather than against 0 and 100, so AA in a spot with no boundary near
   it reads as the easy raise it is. */
export function distanceToBoundary(bucket: Bucket, spot: Spot, hand: string): number {
  const chart = chartFor(bucket, spot);
  const cuts = [chart.aggr, chart.passive].filter((c): c is number => c !== undefined);
  const p = percentileOf(hand);
  return Math.min(...cuts.map((c) => Math.abs(p - c)));
}

/* The chart's own answer for a hand. Read back out of the scorer rather than
   walked again here, so there is one region walk in the client and not two. */
export function bestFor(bucket: Bucket, spot: Spot, hand: string): Action {
  return scoreDecision({ bucket, spot, hand, action: 'fold' }).best;
}

/* A concrete pair of cards for a class, so the puzzle shows two cards rather
   than a piece of notation. Suits carry no meaning preflop beyond whether the
   two share one, which is exactly what the class already says. */
export function cardsFor(hand: string, random: () => number = Math.random): [string, string] {
  const suits = ['s', 'h', 'd', 'c'];
  const first = Math.min(3, Math.floor(random() * 4));
  const offset = 1 + Math.min(2, Math.floor(random() * 3));
  const second = (first + offset) % 4;
  if (hand.length === 2) return [`${hand[0]}${suits[first]}`, `${hand[1]}${suits[second]}`];
  const suited = hand[2] === 's';
  return [`${hand[0]}${suits[first]}`, `${hand[1]}${suits[suited ? first : second]}`];
}

export function dealPreflop(level: number, random: () => number = Math.random): PreflopPuzzle {
  const bucket = choose(BUCKETS, random);
  const spot = choose(SPOTS_BY_BUCKET[bucket], random);
  const [low, high] = DEPTHS[bucket];
  const effectiveBb = low + Math.min(high - low, Math.floor(random() * (high - low + 1)));

  const window = windowFor(level);
  const candidates = ALL_CLASSES.filter((hand) => distanceToBoundary(bucket, spot, hand) <= window);
  /* Every spot has hands near its cutoffs, but a narrow window over a chart
     with one boundary can still come back short; the whole ranking is the
     honest fallback rather than a puzzle that fails to deal. */
  const hand = choose(candidates.length > 0 ? candidates : ALL_CLASSES, random);

  return {
    bucket,
    spot,
    effectiveBb,
    hand,
    cards: cardsFor(hand, random),
    choices: actionsFor(chartFor(bucket, spot)),
    best: bestFor(bucket, spot, hand),
  };
}

export interface PreflopVerdict {
  right: boolean;
  best: Action;
  evLost: number;
}

export function gradePreflop(puzzle: PreflopPuzzle, action: Action): PreflopVerdict {
  const score = scoreDecision({ bucket: puzzle.bucket, spot: puzzle.spot, hand: puzzle.hand, action });
  return { right: score.inRange, best: score.best, evLost: score.evLost };
}

export type GridCell = { hand: string; region: Action };

/* The 13 by 13 grid, each class coloured by the region it falls in for this
   spot. Shown after the answer, never before it. */
export function gridFor(bucket: Bucket, spot: Spot): GridCell[][] {
  return HAND_GRID.map((row) => row.map((hand) => ({ hand, region: bestFor(bucket, spot, hand) })));
}

export function countRegions(grid: GridCell[][]): Record<Action, number> {
  const counts: Record<Action, number> = { aggr: 0, passive: 0, fold: 0 };
  for (const row of grid) for (const cell of row) counts[cell.region] += 1;
  return counts;
}

export { RANKS };
