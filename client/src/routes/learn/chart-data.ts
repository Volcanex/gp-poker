import { RANKS } from '../../../../packages/preflop/src/hand.ts';
import chartsJson from '../../../../packages/preflop/data/charts.json';
import equityJson from '../../../../packages/preflop/data/equity.json';

/* The real baseline chart, read from the same two files the server scores
   against. It cannot come through @opentable/preflop: that package loads its
   data with node:fs, which is fine on the server and impossible here, so the
   JSON is imported directly and the region walk below is the one piece of
   logic mirrored from src/charts.ts. If regionsOf ever changes shape, this
   grid is what drifts. */

export interface ChartEntry {
  aggr?: number;
  passive?: number;
}

export type Region = 'aggr' | 'passive' | 'fold';

const charts = chartsJson as unknown as Record<string, Record<string, ChartEntry | undefined>>;

/* equity.json is written sorted, and re-sorted here for the same reason
   src/equity.ts re-sorts it: the file's order is not something to trust. */
const ranked = ([...(equityJson as unknown as [string, number][])] as [string, number][]).sort((a, b) => b[1] - a[1]);
const percentileByHand = new Map(ranked.map(([hand], i) => [hand, (i / ranked.length) * 100]));

export function chartFor(bucket: string, spot: string): ChartEntry {
  return charts[bucket]?.[spot] ?? {};
}

/* Cumulative cutoffs: aggr owns [0, aggr), passive owns [aggr, passive),
   fold takes the rest. A spot with only one of the two has two regions. */
export function regionFor(entry: ChartEntry, hand: string): Region {
  const p = percentileByHand.get(hand) ?? 100;
  if (entry.aggr !== undefined && p < entry.aggr) return 'aggr';
  if (entry.passive !== undefined && p < entry.passive) return 'passive';
  return 'fold';
}

export interface GridCell {
  hand: string;
  region: Region;
}

/* The grid everybody draws a range on: pairs down the diagonal, suited above
   it, offsuit below, ranks descending both ways. */
export function gridFor(entry: ChartEntry): GridCell[][] {
  return RANKS.map((rowRank, row) =>
    RANKS.map((colRank, col) => {
      const hand =
        row === col ? `${rowRank}${rowRank}` : row < col ? `${rowRank}${colRank}s` : `${colRank}${rowRank}o`;
      return { hand, region: regionFor(entry, hand) };
    })
  );
}

export function countRegions(grid: GridCell[][]): Record<Region, number> {
  const counts: Record<Region, number> = { aggr: 0, passive: 0, fold: 0 };
  for (const row of grid) for (const cell of row) counts[cell.region] += 1;
  return counts;
}
