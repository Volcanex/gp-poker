import { describe, expect, test } from 'vitest';
import {
  ALL_CLASSES,
  combosOf,
  comboCount,
  HAND_GRID,
  parseRange,
  rangeFromTop,
  rangePercent,
  rangeToText,
  RANGE_SIZE,
} from './range.js';

describe('notation', () => {
  test('reads the standard shapes', () => {
    expect(parseRange('22+').size).toBe(13);
    expect([...parseRange('AQo+')].sort()).toEqual(['AKo', 'AQo']);
    expect([...parseRange('T9s-65s')].sort()).toEqual(['65s', '76s', '87s', '98s', 'T9s']);
    expect(parseRange('A2s+').size).toBe(12);
    expect([...parseRange('KTo+')].sort()).toEqual(['KJo', 'KQo', 'KTo']);
    expect([...parseRange('AK')].sort()).toEqual(['AKo', 'AKs']);
    expect([...parseRange('99-77')].sort()).toEqual(['77', '88', '99']);
  });

  test('does not care about case or separators', () => {
    expect(parseRange('aa kk aks')).toEqual(parseRange('AA,KK,AKs'));
  });

  test('says what it could not read', () => {
    expect(() => parseRange('XX')).toThrow(/cannot read/);
    expect(() => parseRange('AAs')).toThrow(/pair cannot be suited/);
    expect(() => parseRange('AKs-QQ')).toThrow(/different kinds/);
    expect(() => parseRange('AQs-32s')).toThrow(/not a run/);
  });

  test('round trips through canonical text', () => {
    const samples = [
      'AA, KK, AKs, AQo+, 22+, T9s-65s, A2s+, KTo+',
      'JJ+, AQs+, AKo',
      '55, 44, A5s, A4s, K9o',
      'AA',
    ];
    for (const text of samples) {
      const range = parseRange(text);
      expect(parseRange(rangeToText(range)), text).toEqual(range);
    }
    for (const percent of [5, 12.5, 40, 87, 100]) {
      const range = rangeFromTop(percent);
      expect(parseRange(rangeToText(range)), `top ${percent}`).toEqual(range);
    }
  });
});

describe('sizes', () => {
  test('the top of the ranking is the whole ranking', () => {
    expect(rangeFromTop(100).size).toBe(169);
    expect(rangeFromTop(0).size).toBe(0);
    expect(comboCount(rangeFromTop(100))).toBe(RANGE_SIZE.total);
    expect(rangePercent(rangeFromTop(100))).toBe(100);
  });

  test('counts combinations by kind, and blocks dead cards', () => {
    expect(combosOf(parseRange('AA')).length).toBe(RANGE_SIZE.pair);
    expect(combosOf(parseRange('AKs')).length).toBe(RANGE_SIZE.suited);
    expect(combosOf(parseRange('AKo')).length).toBe(RANGE_SIZE.offsuit);
    expect(combosOf(parseRange('AA'), ['Ah']).length).toBe(3);
    expect(combosOf(parseRange('AA'), ['Ah', 'Ad', 'Ac']).length).toBe(0);
    expect(combosOf(rangeFromTop(100)).length).toBe(RANGE_SIZE.total);
  });
});

describe('grid', () => {
  test('pairs on the diagonal, suited above, offsuit below, AA top left', () => {
    expect(HAND_GRID.length).toBe(13);
    expect(HAND_GRID[0][0]).toBe('AA');
    expect(HAND_GRID[12][12]).toBe('22');
    expect(HAND_GRID[0][1]).toBe('AKs');
    expect(HAND_GRID[1][0]).toBe('AKo');
    expect(ALL_CLASSES.length).toBe(169);
  });
});
