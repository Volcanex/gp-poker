/* Baseline heads-up preflop charts. These are HEURISTIC, hand-picked from
   equity rankings and standard heads-up strategy shapes (wide button opens,
   linear 3bet/4bet ranges that narrow as raises stack up, Nash push/fold
   approximations under 12bb). They are not solver output, and nobody should
   read them as GTO. See CLAUDE.md for the reasoning behind each number and
   how to retune them.

   A chart entry is { aggr?, passive? }: cumulative percentile cutoffs on the
   equity ranking (0 = best hand). aggr is where the aggressive region ends;
   passive is where the passive region ends (cumulative, so passive > aggr
   when both exist). Fold owns whatever's left up to 100. A spot with only
   one of aggr/passive defined has just two legal regions (raise-or-fold, or
   call-or-fold) rather than three. */

import { loadJson } from './data.js';
import type { DecisionAction, Spot, StackBucket } from './types.js';

export interface ChartEntry {
  aggr?: number;
  passive?: number;
}

type ChartData = Record<StackBucket, Partial<Record<Spot, ChartEntry>>>;

const raw = loadJson<ChartData>('charts.json');

export function chartFor(bucket: StackBucket, spot: Spot): ChartEntry {
  const entry = raw[bucket]?.[spot];
  if (!entry) throw new Error(`no chart entry for ${bucket}/${spot}`);
  return entry;
}

export type Region = [number, number];

export function regionsOf(chart: ChartEntry): Partial<Record<DecisionAction, Region>> {
  const regions: Partial<Record<DecisionAction, Region>> = {};
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
