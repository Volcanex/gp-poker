import { describe, expect, it } from 'vitest';
import { axisPoints, styleWords, wilsonInterval } from '../review/style.ts';
import { reads } from '../review/reads.ts';
import type { MatchRawRates } from '../net/types.ts';

function rates(over: Partial<MatchRawRates> = {}): MatchRawRates {
  return {
    hands: 10,
    vpip: { made: 3, of: 10, pct: 30 },
    pfr: { made: 2, of: 10, pct: 20 },
    threeBet: { made: 0, of: 0, pct: null },
    aggressionFactor: { made: 4, of: 2, pct: 200 },
    cbet: { made: 1, of: 2, pct: 50 },
    wentToShowdown: { made: 1, of: 4, pct: 25 },
    ...over,
  };
}

describe('axisPoints', () => {
  it('never invents a ring position for an axis with no denominator', () => {
    const points = axisPoints(rates());
    const threeBet = points.find((p) => p.axis.key === 'threeBet')!;
    expect(threeBet.value).toBeNull();
    expect(threeBet.display).toBe('No chances yet');
  });

  it('normalises a percentage axis against its reference band, clamped at the ring', () => {
    const points = axisPoints(rates({ vpip: { made: 9, of: 10, pct: 90 } }));
    const vpip = points.find((p) => p.axis.key === 'vpip')!;
    expect(vpip.value).toBe(1); // 90% against a 70% max, clamped
    expect(vpip.display).toBe('9 of 10 hands');
  });

  it('reads aggression factor as a multiple, not a percentage', () => {
    const points = axisPoints(rates());
    const af = points.find((p) => p.axis.key === 'aggressionFactor')!;
    expect(af.display).toBe('2.00x over 2 calls');
  });
});

describe('wilsonInterval', () => {
  it('has nothing to estimate from zero chances', () => {
    expect(wilsonInterval(0, 0)).toBeNull();
  });

  it('narrows continuously as the sample grows, with no threshold anywhere', () => {
    const one = wilsonInterval(1, 1)!;
    const eight = wilsonInterval(4, 8)!;
    const fortyFour = wilsonInterval(22, 44)!;
    const widthOf = (b: { lower: number; upper: number }) => b.upper - b.lower;
    // Same point estimate (0.5) at every size; only the width should move.
    expect(widthOf(one)).toBeGreaterThan(widthOf(eight));
    expect(widthOf(eight)).toBeGreaterThan(widthOf(fortyFour));
  });

  it('swallows nearly the whole axis at a single observation', () => {
    const won = wilsonInterval(1, 1)!;
    expect(won.upper - won.lower).toBeGreaterThan(0.6);
  });

  it('draws a materially tighter band once the sample is real', () => {
    const one = wilsonInterval(1, 1)!;
    const b = wilsonInterval(22, 44)!;
    // 1 of 1 spans the whole axis (0.79 wide, upper pinned at 1); 22 of 44
    // is under half that width and centred, not pinned to an edge.
    expect(b.upper - b.lower).toBeLessThan((one.upper - one.lower) / 2);
    expect(b.lower).toBeLessThan(0.5);
    expect(b.upper).toBeGreaterThan(0.5);
  });

  it('never lets a bound leave 0..1', () => {
    const near1 = wilsonInterval(50, 50)!;
    const near0 = wilsonInterval(0, 50)!;
    expect(near1.upper).toBeLessThanOrEqual(1);
    expect(near0.lower).toBeGreaterThanOrEqual(0);
  });
});

describe('axisPoints, the uncertainty band', () => {
  it('gives a proportion axis a wide band at one hand and a tight one at forty-four', () => {
    const short = axisPoints(rates({ vpip: { made: 1, of: 1, pct: 100 } })).find((p) => p.axis.key === 'vpip')!;
    const long = axisPoints(rates({ vpip: { made: 22, of: 44, pct: 50 } })).find((p) => p.axis.key === 'vpip')!;
    expect(short.lower).not.toBeNull();
    expect(short.upper! - short.lower!).toBeGreaterThan(long.upper! - long.lower!);
    // The single-hand shape still can't claim a tight, confident ring even
    // though its point sits at the same saturated 100%.
    expect(short.upper! - short.lower!).toBeGreaterThan(0.3);
  });

  it('gives aggression factor no band at all, ratio rather than proportion', () => {
    const af = axisPoints(rates({ aggressionFactor: { made: 40, of: 20, pct: 2000 } })).find(
      (p) => p.axis.key === 'aggressionFactor'
    )!;
    expect(af.lower).toBeNull();
    expect(af.upper).toBeNull();
  });

  it('keeps the no-chances axis a marker, not a full-width band', () => {
    const p = axisPoints(rates()).find((p) => p.axis.key === 'threeBet')!;
    expect(p.lower).toBeNull();
    expect(p.upper).toBeNull();
  });
});

describe('styleWords', () => {
  it('refuses to name a style with no aggression sample behind it', () => {
    expect(styleWords(rates({ aggressionFactor: { made: 0, of: 0, pct: null } }))).toBeNull();
  });

  it('names a loose aggressive player from the two plainest axes', () => {
    const style = styleWords(
      rates({ vpip: { made: 5, of: 10, pct: 50 }, aggressionFactor: { made: 6, of: 3, pct: 200 } })
    );
    expect(style).toBe('Loose aggressive');
  });

  it('names a tight passive player', () => {
    const style = styleWords(
      rates({ vpip: { made: 1, of: 10, pct: 10 }, aggressionFactor: { made: 1, of: 4, pct: 25 } })
    );
    expect(style).toBe('Tight passive');
  });

  it('falls back to Balanced rather than a blank label', () => {
    const style = styleWords(
      rates({ vpip: { made: 3, of: 10, pct: 30 }, aggressionFactor: { made: 2, of: 2, pct: 100 } })
    );
    expect(style).toBe('Balanced');
  });
});

describe('reads', () => {
  it('says nothing below the count a sentence needs to mean anything', () => {
    // rates() has threeBet.of === 0, below the floor of 2 a real read needs.
    expect(reads(rates()).some((r) => r.includes('Never three-bet'))).toBe(false);
  });

  it('calls out a real zero with its own count once the sample is there', () => {
    const out = reads(rates({ threeBet: { made: 0, of: 3, pct: 0 } }));
    expect(out).toEqual(expect.arrayContaining([expect.stringContaining('Never three-bet when given the chance, 3 times')]));
  });

  it('never claims a rate from a sample too small to back it', () => {
    const out = reads(rates({ vpip: { made: 1, of: 3, pct: 33.3 } }));
    expect(out.some((r) => r.includes('voluntarily'))).toBe(false);
  });
});
