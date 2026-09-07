import { describe, it, expect } from 'vitest';
import { equityOf, percentileOf, rankedHands, TOTAL_HANDS } from '../src/equity.js';

describe('equity table', () => {
  it('has 169 entries', () => {
    expect(TOTAL_HANDS).toBe(169);
    expect(rankedHands()).toHaveLength(169);
  });

  it('ranks AA on top', () => {
    expect(rankedHands()[0][0]).toBe('AA');
    expect(percentileOf('AA')).toBe(0);
  });

  it('puts 72o and 32o near the bottom', () => {
    const ranked = rankedHands().map(([hand]) => hand);
    const i72o = ranked.indexOf('72o');
    const i32o = ranked.indexOf('32o');
    expect(i72o).toBeGreaterThan(ranked.length - 15);
    expect(i32o).toBeGreaterThan(ranked.length - 15);
  });

  it('is monotone: suited beats offsuit, higher pairs beat lower pairs', () => {
    expect(equityOf('AKs')).toBeGreaterThan(equityOf('AKo'));
    expect(equityOf('KK')).toBeGreaterThan(equityOf('QQ'));
    expect(equityOf('AA')).toBeGreaterThan(equityOf('KK'));
  });

  it('throws on an unknown class', () => {
    expect(() => equityOf('XX')).toThrow();
    expect(() => percentileOf('XX')).toThrow();
  });
});
