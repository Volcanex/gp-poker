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
  // The Wilson interval's two bounds, normalised onto the same ring `value`
  // is. Null for the same reason `value` is null (of: 0), and also null on
  // a ratio axis (aggressionFactor), which is not a proportion of hands and
  // has no binomial interval to compute (see wilsonInterval's own doc).
  // Present and equal to `value` is not a thing that happens: even one
  // observation has a wide interval, which is the entire point.
  lower: number | null;
  upper: number | null;
  display: string; // "3 of 8 hands" style caption, always present
}

function fmtRaw(rate: RawRate, unit: '%' | 'x'): string {
  if (rate.of === 0) return 'No chances yet';
  if (unit === 'x') return `${(rate.made / rate.of).toFixed(2)}x over ${rate.of} ${rate.of === 1 ? 'call' : 'calls'}`;
  return `${rate.made} of ${rate.of} ${rate.of === 1 ? 'hand' : 'hands'}`;
}

/* The 95% Wilson score interval for made/of, the standard correction for a
   binomial proportion estimated from a small sample (a normal/Wald interval
   centred on p-hat is a bad approximation exactly where this feature needs
   one most: n under 30, p near 0 or 1). At of:1 the interval spans nearly
   the whole 0..1 axis; it narrows as of grows, with no threshold anywhere
   in the arithmetic for a sample to cross before it is "trusted": the
   shape is uncertain in continuous proportion to how little happened, not
   suddenly confident past a cutoff. Null when there is nothing to estimate
   from (of: 0), which the caller already draws as the open, no-data marker
   rather than any interval at all. */
export function wilsonInterval(made: number, of: number, z = 1.96): { lower: number; upper: number } | null {
  if (of === 0) return null;
  const n = of;
  const p = made / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lower: Math.max(0, centre - margin), upper: Math.min(1, centre + margin) };
}

export function axisPoints(raw: MatchRawRates): AxisPoint[] {
  return AXES.map((axis) => {
    const rate = raw[axis.key];
    const ratio = rate.of === 0 ? null : rate.made / rate.of;
    const norm = (r: number) => Math.max(0, Math.min(1, (axis.unit === 'x' ? r : r * 100) / axis.max));
    // Aggression factor is bets-and-raises per call, unbounded above 1 and
    // not a share of a fixed number of trials: Wilson is defined for a
    // proportion and would be a second, silent unbacked claim layered on
    // top of the first if applied here anyway.
    const wilson = axis.unit === 'x' ? null : wilsonInterval(rate.made, rate.of);
    return {
      axis,
      rate,
      value: ratio === null ? null : norm(ratio),
      lower: wilson ? norm(wilson.lower) : null,
      upper: wilson ? norm(wilson.upper) : null,
      display: fmtRaw(rate, axis.unit),
    };
  });
}

/* "Tight aggressive" and its five relatives: named the way a player would
   describe themselves, from the two axes with the plainest read (VPIP for
   loose/tight, aggression factor for passive/aggressive) rather than an
   average of all six, which would blur a chart that is trying to separate
   them. Requires a real chance behind both halves of the label: a seat that
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
