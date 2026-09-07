import { describe, expect, it } from 'vitest';
import { pairQueue, window, type QueueEntry } from '../src/matchmaking.js';

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('window', () => {
  it('is unbounded after 60 seconds waited', () => {
    const entry: QueueEntry = { id: 'a', rating: 1500, rd: 50, joinedAt: 0 };
    expect(window(entry, 60000)).toBe(Infinity);
    expect(window(entry, 59999)).toBeLessThan(Infinity);
  });

  it('widens by 50 every 5 seconds and caps at 1000 before the unbounded cutoff', () => {
    const entry: QueueEntry = { id: 'a', rating: 1500, rd: 30, joinedAt: 0 };
    expect(window(entry, 0)).toBe(100);
    expect(window(entry, 5000)).toBe(150);
    expect(window(entry, 10000)).toBe(200);
  });
});

describe('pairQueue', () => {
  it('does not pair two players 900 apart at t=0 but does after 60 seconds', () => {
    const a: QueueEntry = { id: 'a', rating: 1000, rd: 50, joinedAt: 0 };
    const b: QueueEntry = { id: 'b', rating: 1900, rd: 50, joinedAt: 0 };

    expect(pairQueue([a, b], 0)).toEqual([]);
    expect(pairQueue([a, b], 60000)).toEqual([[a, b]]);
  });

  it('never pairs the same entry twice and only within both windows, and pairs everyone within 90s', () => {
    const rand = mulberry32(7);
    const entries: QueueEntry[] = Array.from({ length: 50 }, (_, i) => ({
      id: `p${i}`,
      rating: 800 + Math.floor(rand() * 1400),
      rd: 30 + Math.floor(rand() * 320),
      joinedAt: Math.floor(rand() * 30000),
    }));

    const pending = new Map(entries.map((e) => [e.id, e]));
    const pairedAt = new Map<string, number>();

    for (let t = 1000; t <= 120000; t += 1000) {
      const active = [...pending.values()].filter((e) => e.joinedAt <= t);
      if (active.length === 0) continue;

      const pairs = pairQueue(active, t);

      const seen = new Set<string>();
      for (const [x, y] of pairs) {
        expect(seen.has(x.id)).toBe(false);
        expect(seen.has(y.id)).toBe(false);
        seen.add(x.id);
        seen.add(y.id);

        const diff = Math.abs(x.rating - y.rating);
        expect(diff).toBeLessThanOrEqual(window(x, t));
        expect(diff).toBeLessThanOrEqual(window(y, t));

        pairedAt.set(x.id, t);
        pairedAt.set(y.id, t);
        pending.delete(x.id);
        pending.delete(y.id);
      }
    }

    for (const entry of entries) {
      const at = pairedAt.get(entry.id);
      expect(at, `entry ${entry.id} never paired`).toBeDefined();
      expect((at as number) - entry.joinedAt).toBeLessThanOrEqual(90000);
    }
  });
});
