/* ranking.ts re-exports @opentable/preflop's own ranking and percentile
   functions rather than deriving them again, so this is a thin regression
   pin: if a future edit turns that re-export back into a local copy, this
   fails the moment the two disagree instead of quietly serving the client a
   different ranking from the one the server grades against. */

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
