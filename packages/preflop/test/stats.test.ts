import { describe, it, expect } from 'vitest';
import { handStats } from '../src/extract.js';
import type { LoggedAction } from '@opentable/protocol';

const config = { seats: [{ stack: 200 }, { stack: 200 }], button: 0, bb: 2 };

describe('handStats', () => {
  it('tracks vpip, pfr and aggr/passive counts across all streets', () => {
    const actions: LoggedAction[] = [
      { s: 0, a: 'r', v: 6, t: 0 },
      { s: 1, a: 'c', t: 100 },
      { s: 1, a: 'x', t: 200 },
      { s: 0, a: 'b', v: 10, t: 300 },
      { s: 1, a: 'c', t: 400 },
      { s: 1, a: 'x', t: 500 },
      { s: 0, a: 'x', t: 600 },
    ];
    const stats = handStats(config, actions);
    expect(stats[0]).toMatchObject({ vpip: true, pfr: true, aggr: 2, passive: 1, faced3bet: false, foldTo3bet: false });
    expect(stats[1]).toMatchObject({ vpip: true, pfr: false, aggr: 0, passive: 4, faced3bet: false, foldTo3bet: false });
  });

  it('tracks faced3bet and foldTo3bet for the seat that faces the 3bet', () => {
    const actions: LoggedAction[] = [
      { s: 0, a: 'r', v: 6, t: 0 },
      { s: 1, a: 'r', v: 20, t: 100 },
      { s: 0, a: 'r', v: 60, t: 200 },
      { s: 1, a: 'f', t: 300 },
    ];
    const stats = handStats(config, actions);
    expect(stats[0]).toMatchObject({ vpip: true, pfr: true, faced3bet: true, foldTo3bet: false });
    expect(stats[1]).toMatchObject({ vpip: true, pfr: true, faced3bet: false, foldTo3bet: false });
  });

  it('marks foldTo3bet when the seat facing the 3bet folds', () => {
    const actions: LoggedAction[] = [
      { s: 0, a: 'r', v: 6, t: 0 },
      { s: 1, a: 'r', v: 20, t: 100 },
      { s: 0, a: 'f', t: 200 },
    ];
    const stats = handStats(config, actions);
    expect(stats[0]).toMatchObject({ vpip: true, pfr: true, faced3bet: true, foldTo3bet: true });
  });

  it('a fold-preflop seat that never acts postflop stays at zero counts', () => {
    const actions: LoggedAction[] = [
      { s: 0, a: 'r', v: 6, t: 0 },
      { s: 1, a: 'f', t: 100 },
    ];
    const stats = handStats(config, actions);
    expect(stats[1]).toMatchObject({ vpip: false, pfr: false, aggr: 0, passive: 0 });
  });
});
