import { describe, expect, it } from 'vitest';
import { axisPoints, styleWords } from '../review/style.ts';
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
