import type { MatchRawRates, RawRate } from '../net/types.ts';

/* The spider chart's axes, and the reference bands they are drawn against.
   Pure, and deliberately separate from the fetch: `match-review.tsx` is the
   only thing that knows a request is in flight, everything here is a
   function of the numbers that came back.

   A band is a claim about what "typical" looks like, stated so the chart can
   be read as more than a shape: `max` is where the axis saturates (100% of
   the ring), and `typical` is the pair the caption prints as "most players
   land between X and Y", not a line drawn on the chart itself, because a
   drawn band on six overlapping axes reads as six new shapes to parse. The
   raw made-of-of count travels with every axis regardless: the ring position
   is a normalised read of a number that is always printed next to it. */
export type AxisKey = 'vpip' | 'pfr' | 'threeBet' | 'aggressionFactor' | 'cbet' | 'wentToShowdown';

export interface AxisBand {
  key: AxisKey;
  label: string;
  short: string;
  max: number;
  typical: [number, number];
  unit: '%' | 'x';
  what: string;
}

export const AXES: AxisBand[] = [
  { key: 'vpip', label: 'Voluntarily played (VPIP)', short: 'VPIP', max: 70, typical: [15, 40], unit: '%', what: 'hands played with money in voluntarily' },
  { key: 'pfr', label: 'Raised preflop (PFR)', short: 'PFR', max: 60, typical: [10, 28], unit: '%', what: 'hands raised before the flop' },
  { key: 'threeBet', label: 'Three-bet', short: '3bet', max: 30, typical: [4, 12], unit: '%', what: 'chances to reraise preflop that were taken' },
  { key: 'aggressionFactor', label: 'Aggression factor', short: 'Aggr', max: 4, typical: [1, 2.5], unit: 'x', what: 'postflop bets and raises per call' },
  { key: 'cbet', label: 'Continuation bet', short: 'C-bet', max: 100, typical: [45, 75], unit: '%', what: 'flops bet after raising preflop' },
  { key: 'wentToShowdown', label: 'Went to showdown', short: 'WTSD', max: 60, typical: [22, 32], unit: '%', what: 'flops seen that reached a showdown' },
];

export interface AxisPoint {
  axis: AxisBand;
  rate: RawRate;
  // The 0..1 ring position. Null when `rate.of` is zero: there is nothing to
  // normalise, and plotting a guess at any radius is the claim this whole
  // feature exists to refuse. The chart draws these as an open ring at the
  // centre and a dashed spoke, never a filled point.
  value: number | null;
  display: string; // "3 of 8 hands" style caption, always present
}

function fmtRaw(rate: RawRate, unit: '%' | 'x'): string {
  if (rate.of === 0) return 'No chances yet';
  if (unit === 'x') return `${(rate.made / rate.of).toFixed(2)}x over ${rate.of} ${rate.of === 1 ? 'call' : 'calls'}`;
  return `${rate.made} of ${rate.of} ${rate.of === 1 ? 'hand' : 'hands'}`;
}

export function axisPoints(raw: MatchRawRates): AxisPoint[] {
  return AXES.map((axis) => {
    const rate = raw[axis.key];
    const ratio = rate.of === 0 ? null : rate.made / rate.of;
    const scaled = axis.unit === 'x' ? (ratio ?? 0) : (ratio ?? 0) * 100;
    return {
      axis,
      rate,
      value: ratio === null ? null : Math.max(0, Math.min(1, scaled / axis.max)),
      display: fmtRaw(rate, axis.unit),
    };
  });
}

/* "Tight aggressive" and its five relatives: named the way a player would
   describe themselves, from the two axes with the plainest read (VPIP for
   loose/tight, aggression factor for passive/aggressive) rather than an
   average of all six, which would blur a chart that is trying to separate
   them. Requires a real chance behind both halves of the label — a seat that
   never called can't be scored passive or aggressive, and the function says
   so instead of defaulting to "balanced", which would be a guess wearing a
   neutral word. */
export function styleWords(raw: MatchRawRates): string | null {
  const vpip = raw.vpip.of > 0 ? raw.vpip.made / raw.vpip.of : null;
  const af = raw.aggressionFactor.of > 0 ? raw.aggressionFactor.made / raw.aggressionFactor.of : null;
  if (vpip === null || af === null) return null;
  const looseness = vpip >= 0.4 ? 'Loose' : vpip <= 0.2 ? 'Tight' : 'Neutral';
  const temper = af >= 1.5 ? 'aggressive' : af <= 0.5 ? 'passive' : 'balanced';
  if (looseness === 'Neutral' && temper === 'balanced') return 'Balanced';
  if (looseness === 'Neutral') return temper === 'aggressive' ? 'Aggressive' : 'Passive';
  return `${looseness} ${temper}`;
}
