/* The heads-up equity ranking and the raw chart data, re-exported from
   @opentable/preflop, which now reads both JSON files with static imports and
   so is safe to import here, in a web worker.

   The one thing kept local is `charts()`: preflop's public API only offers
   single-entry lookups (`chartFor(bucket, spot)`), and `presets.ts` needs to
   enumerate every entry to build a preset per spot. That is plain JSON access
   with the `notes` key stripped, not a re-derivation of anything, so it stays
   here rather than growing preflop's API for one caller. */

import rawCharts from '@opentable/preflop/data/charts.json' with { type: 'json' };

export { rankedHands as rankedClasses, percentileOf as percentileOfClass, equityOf as equityOfClass, TOTAL_HANDS } from '@opentable/preflop';

export type ChartEntry = { aggr?: number; passive?: number };
export type ChartData = Record<string, Record<string, ChartEntry>>;

export function charts(): ChartData {
  const { notes, ...buckets } = rawCharts as unknown as ChartData & { notes?: string };
  void notes;
  return buckets as ChartData;
}
