import { describe, it, expect } from 'vitest';
import { summarise } from '../src/summarise.js';
import type { Decision } from '../src/types.js';

function decision(evLost: number, inRange: boolean): Decision {
  return { seat: 0, spot: 'sb_open', bucket: 'deep', hand: 'AA', action: 'aggr', best: 'aggr', evLost, inRange };
}

describe('summarise', () => {
  it('is 100 accuracy with zero EV lost', () => {
    const s = summarise([decision(0, true), decision(0, true)]);
    expect(s).toEqual({ evLost: 0, accuracy: 100, count: 2 });
  });

  it('computes accuracy as 100 * (1 - evLost / (count * 2))', () => {
    const s = summarise([decision(1, false), decision(1, false)]);
    // evLost = 2, count = 2 -> 1 - 2/4 = 0.5 -> 50
    expect(s).toEqual({ evLost: 2, accuracy: 50, count: 2 });
  });

  it('floors accuracy at 0 rather than going negative', () => {
    const s = summarise([decision(8, false), decision(8, false)]);
    expect(s.accuracy).toBe(0);
  });

  it('defaults to 100 accuracy with no decisions', () => {
    const s = summarise([]);
    expect(s).toEqual({ evLost: 0, accuracy: 100, count: 0 });
  });
});
