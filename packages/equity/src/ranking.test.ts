/* This package reads preflop's data files directly, because preflop's own
   loader is node only and this code has to run in a browser worker. That is a
   copy of two derivations (the sort and the percentile), so it is worth a test:
   if preflop ever changes how it ranks, this fails rather than quietly serving
   a different ranking to the client than the one the server grades against. */

import { describe, expect, test } from 'vitest';
import { chartFor, percentileOf, rankedHands, TOTAL_HANDS as PREFLOP_TOTAL } from '@opentable/preflop';
import { percentileOfClass, rankedClasses, TOTAL_HANDS } from './ranking.js';
import { chartPresets } from './presets.js';

describe('ranking', () => {
  test('matches the ranking @opentable/preflop derives', () => {
    expect(TOTAL_HANDS).toBe(PREFLOP_TOTAL);
    expect(rankedClasses()).toEqual(rankedHands());
    for (const [cls] of rankedClasses()) {
      expect(percentileOfClass(cls), cls).toBe(percentileOf(cls));
    }
  });

  test('every chart preset matches the chart it came from', () => {
    const presets = chartPresets();
    expect(presets.length).toBe(14);
    for (const preset of presets) {
      const entry = chartFor(preset.bucket as never, preset.spot as never);
      expect(preset.percent, preset.id).toBe(entry.aggr ?? entry.passive);
      expect(preset.range.size, preset.id).toBeGreaterThan(0);
    }
  });
});
