import { describe, it, expect } from 'vitest';
import { scoreDecision } from '../src/score.js';

describe('scoreDecision', () => {
  it('gives 0 evLost for an in-range aggressive action', () => {
    const r = scoreDecision({ spot: 'sb_open', bucket: 'deep', hand: 'AA', action: 'aggr' });
    expect(r.best).toBe('aggr');
    expect(r.inRange).toBe(true);
    expect(r.evLost).toBe(0);
  });

  it('gives 0 evLost for an in-range fold', () => {
    const r = scoreDecision({ spot: 'sb_open', bucket: 'deep', hand: '32o', action: 'fold' });
    expect(r.best).toBe('fold');
    expect(r.inRange).toBe(true);
    expect(r.evLost).toBe(0);
  });

  it('penalises folding the best hand heavily', () => {
    const r = scoreDecision({ spot: 'sb_open', bucket: 'deep', hand: 'AA', action: 'fold' });
    expect(r.inRange).toBe(false);
    expect(r.evLost).toBeGreaterThan(3);
    expect(r.evLost).toBeLessThanOrEqual(8);
  });

  it('penalises folding more the further the hand is from the fold boundary', () => {
    const nearBoundary = scoreDecision({ spot: 'bb_vs_open', bucket: 'deep', hand: 'J3o', action: 'fold' });
    const deepInRange = scoreDecision({ spot: 'bb_vs_open', bucket: 'deep', hand: 'AA', action: 'fold' });
    expect(deepInRange.evLost).toBeGreaterThan(nearBoundary.evLost);
  });

  it('penalises shoving a clear fold-region hand, but less than folding the nuts', () => {
    const badShove = scoreDecision({ spot: 'sb_open', bucket: 'deep', hand: '32o', action: 'aggr' });
    const nutsFold = scoreDecision({ spot: 'sb_open', bucket: 'deep', hand: 'AA', action: 'fold' });
    expect(badShove.evLost).toBeGreaterThan(0);
    expect(badShove.evLost).toBeLessThan(nutsFold.evLost);
  });

  it('caps evLost at 8 bb', () => {
    const r = scoreDecision({ spot: 'bb_vs_4bet', bucket: 'deep', hand: 'AA', action: 'fold' });
    expect(r.evLost).toBeLessThanOrEqual(8);
  });

  it('degrades gracefully for an action with no charted region in a two-action spot', () => {
    const r = scoreDecision({ spot: 'sb_push', bucket: 'push', hand: 'AA', action: 'passive' });
    expect(r.best).toBe('aggr');
    expect(r.inRange).toBe(false);
    expect(r.evLost).toBeGreaterThanOrEqual(0);
    expect(r.evLost).toBeLessThanOrEqual(8);
  });

  it('scores push charts with call-or-fold only', () => {
    const call = scoreDecision({ spot: 'bb_vs_push', bucket: 'push', hand: 'AA', action: 'passive' });
    expect(call.best).toBe('passive');
    expect(call.inRange).toBe(true);
    const fold = scoreDecision({ spot: 'bb_vs_push', bucket: 'push', hand: '72o', action: 'fold' });
    expect(fold.inRange).toBe(true);
  });
});
