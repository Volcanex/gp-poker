/* The heads-up equity ranking of the 169 hand classes, read in a way that works
   in a browser as well as in node.

   @opentable/preflop owns this data and derives the same ranking in
   src/equity.ts, but it loads it with readFileSync, which cannot run in the web
   worker this package exists to feed. So the JSON is imported directly through
   preflop's exports map and the two derived values (order and percentile) are
   recomputed here. ranking.test.ts asserts they match preflop's own, so the two
   cannot drift apart silently. */

import rawEquity from '@opentable/preflop/data/equity.json' with { type: 'json' };
import rawCharts from '@opentable/preflop/data/charts.json' with { type: 'json' };

export type ChartEntry = { aggr?: number; passive?: number };
export type ChartData = Record<string, Record<string, ChartEntry>>;

// Re-sorted rather than trusted, for the same reason preflop re-sorts: the file
// is an array precisely because object key order could not be relied on.
const ranked: [string, number][] = [...(rawEquity as [string, number][])].sort((a, b) => b[1] - a[1]);

export const TOTAL_HANDS = ranked.length;

const percentiles = new Map<string, number>(ranked.map(([hand], i) => [hand, (i / TOTAL_HANDS) * 100]));

export function rankedClasses(): [string, number][] {
  return ranked;
}

export function percentileOfClass(hand: string): number {
  const p = percentiles.get(hand);
  if (p === undefined) throw new Error(`unknown hand class: ${hand}`);
  return p;
}

export function equityOfClass(hand: string): number {
  const found = ranked.find(([h]) => h === hand);
  if (!found) throw new Error(`unknown hand class: ${hand}`);
  return found[1];
}

export function charts(): ChartData {
  const { notes, ...buckets } = rawCharts as unknown as ChartData & { notes?: string };
  void notes;
  return buckets as ChartData;
}
