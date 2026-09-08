/* The baseline preflop chart, read in a browser.

   @opentable/preflop owns this data and the scoring, but its entry point loads
   both JSON files with node:fs, so nothing in the client can import it. The two
   files are read directly instead and the three pieces of logic that sit on top
   of them are mirrored here: the percentile ranking from src/equity.ts, the
   region walk from src/charts.ts, and the EV-lost scale from src/score.ts.

   That mirror is pinned rather than trusted. src/test/puzzles.test.ts imports
   the real package (a test runs in node, where readFileSync is fine) and checks
   every bucket, spot and hand class against the copy below, so a change to the
   scorer fails there instead of quietly grading a puzzle differently from the
   way the same decision is graded at the table.

   src/routes/learn/chart-data.ts reads the same two files for the lesson's
   grid. It is the same bargain for the same reason. */

import chartsJson from '../../../packages/preflop/data/charts.json';
import equityJson from '../../../packages/preflop/data/equity.json';

export type Bucket = 'deep' | 'mid' | 'short' | 'push';
export type Spot = 'sb_open' | 'bb_vs_open' | 'sb_vs_3bet' | 'bb_vs_4bet' | 'sb_push' | 'bb_vs_push';
export type Action = 'aggr' | 'passive' | 'fold';

export interface ChartEntry {
  aggr?: number;
  passive?: number;
}

export type Region = [number, number];

export const BUCKETS: Bucket[] = ['deep', 'mid', 'short', 'push'];
export const EV_PER_PERCENTILE = 1 / 18;
export const MAX_EV_LOST = 8;

const charts = chartsJson as unknown as Record<Bucket, Partial<Record<Spot, ChartEntry>>>;

/* Re-sorted rather than trusted, for the reason preflop re-sorts it: the file
   is an array precisely because object key order could not be relied on. */
const ranked = ([...(equityJson as unknown as [string, number][])]).sort((a, b) => b[1] - a[1]);

export const TOTAL_HANDS = ranked.length;

const percentileByHand = new Map(ranked.map(([hand], i) => [hand, (i / TOTAL_HANDS) * 100]));

export function percentileOf(hand: string): number {
  const p = percentileByHand.get(hand);
  if (p === undefined) throw new Error(`unknown hand class: ${hand}`);
  return p;
}

export function rankedHands(): [string, number][] {
  return ranked;
}

export function chartFor(bucket: Bucket, spot: Spot): ChartEntry {
  const entry = charts[bucket]?.[spot];
  if (!entry) throw new Error(`no chart entry for ${bucket}/${spot}`);
  return entry;
}

/* Cumulative cutoffs: aggr owns [0, aggr], passive owns [aggr, passive], fold
   takes the rest. A spot with only one of the two has two regions, not three. */
export function regionsOf(chart: ChartEntry): Partial<Record<Action, Region>> {
  const regions: Partial<Record<Action, Region>> = {};
  let cursor = 0;
  if (chart.aggr !== undefined) {
    regions.aggr = [0, chart.aggr];
    cursor = chart.aggr;
  }
  if (chart.passive !== undefined) {
    regions.passive = [cursor, chart.passive];
    cursor = chart.passive;
  }
  regions.fold = [cursor, 100];
  return regions;
}

const ACTIONS: Action[] = ['aggr', 'passive', 'fold'];

/* Which actions a spot can be answered with, in the order they are offered:
   the regions the chart defines, plus fold, which always exists. */
export function actionsFor(chart: ChartEntry): Action[] {
  const regions = regionsOf(chart);
  return ACTIONS.filter((a) => regions[a] !== undefined);
}

export interface ScoreResult {
  best: Action;
  evLost: number;
  inRange: boolean;
}

export function scoreDecision(input: { bucket: Bucket; spot: Spot; hand: string; action: Action }): ScoreResult {
  const chart = chartFor(input.bucket, input.spot);
  const regions = regionsOf(chart);
  const p = percentileOf(input.hand);

  const best =
    ACTIONS.find((a) => {
      const r = regions[a];
      return r && p >= r[0] && p <= r[1];
    }) ?? 'fold';

  if (input.action === best) return { best, evLost: 0, inRange: true };

  const region =
    regions[input.action] ??
    (() => {
      const boundary = chart.aggr ?? chart.passive ?? 0;
      return [boundary, boundary] as Region;
    })();

  const distance = p < region[0] ? region[0] - p : p > region[1] ? p - region[1] : 0;
  return { best, evLost: Math.min(distance * EV_PER_PERCENTILE, MAX_EV_LOST), inRange: false };
}

/* Mirrors bucketFor in packages/preflop/src/extract.ts. */
export function bucketFor(effectiveBb: number): Bucket {
  if (effectiveBb >= 60) return 'deep';
  if (effectiveBb >= 25) return 'mid';
  if (effectiveBb >= 12) return 'short';
  return 'push';
}

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
