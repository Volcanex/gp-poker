/* The baseline heads-up charts from @opentable/preflop, turned into ranges a
   picker can load. Each chart entry is a percentile cutoff on the equity
   ranking, so the range it names is simply the top slice.

   These are the same heuristic baselines the accuracy scorer grades against,
   not solver output, and the labels say so in plain words rather than in the
   chart's own jargon. */

import { charts } from './ranking.js';
import { rangeFromTop, type Range } from './range.js';

export interface ChartPreset {
  id: string; // "deep/sb_open"
  label: string; // "Small blind open, deep"
  bucket: string;
  spot: string;
  percent: number; // top slice of the ranking this range is
  range: Range;
}

const SPOT_WORDS: Record<string, string> = {
  sb_open: 'Small blind open',
  bb_vs_open: 'Big blind vs an open',
  sb_vs_3bet: 'Small blind vs a 3bet',
  bb_vs_4bet: 'Big blind vs a 4bet',
  sb_push: 'Small blind jam',
  bb_vs_push: 'Big blind calling a jam',
};

const BUCKET_WORDS: Record<string, string> = {
  deep: 'deep',
  mid: 'mid stack',
  short: 'short',
  push: 'under 12bb',
};

export function chartPresets(): ChartPreset[] {
  const out: ChartPreset[] = [];
  for (const [bucket, spots] of Object.entries(charts())) {
    for (const [spot, entry] of Object.entries(spots)) {
      // Two of the six spots have one region only: jam or fold, call or fold.
      // Whichever region exists is the range a player is picking here.
      const percent = entry.aggr ?? entry.passive;
      if (percent === undefined) continue;
      out.push({
        id: `${bucket}/${spot}`,
        label: `${SPOT_WORDS[spot] ?? spot}, ${BUCKET_WORDS[bucket] ?? bucket}`,
        bucket,
        spot,
        percent,
        range: rangeFromTop(percent),
      });
    }
  }
  return out;
}
