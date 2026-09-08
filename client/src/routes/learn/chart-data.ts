import { RANKS, chartFor as realChartFor, percentileOf, regionsOf, type Spot, type StackBucket } from '@opentable/preflop';

/* The range grid's display shape, built from @opentable/preflop's own chart,
   percentile and region logic. It cannot import @opentable/protocol-shaped
   bucket/spot literals from callers that only have strings (`ranges.tsx`
   passes constants), so the two lookups below take `string` and narrow
   internally rather than pushing the union types out to every caller. */

export interface ChartEntry {
  aggr?: number;
  passive?: number;
}

export type Region = 'aggr' | 'passive' | 'fold';

const REGION_ORDER: Region[] = ['aggr', 'passive', 'fold'];

export function chartFor(bucket: string, spot: string): ChartEntry {
  return realChartFor(bucket as StackBucket, spot as Spot);
}

/* The same first-matching-region walk scoreDecision uses to pick `best`, so
   the grid always agrees with what the accuracy scorer would call correct. */
export function regionFor(entry: ChartEntry, hand: string): Region {
  const p = percentileOf(hand);
  const regions = regionsOf(entry);
  return REGION_ORDER.find((r) => {
    const range = regions[r];
    return range && p >= range[0] && p <= range[1];
  }) ?? 'fold';
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
