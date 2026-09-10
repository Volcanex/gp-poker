import { describe, expect, it } from 'vitest';
import { anyone, groupQueue, pairQueue, window, type QueueEntry } from '../src/matchmaking.js';

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
  it('is unbounded after 30 seconds waited', () => {
    const entry: QueueEntry = { id: 'a', rating: 1500, rd: 50, joinedAt: 0 };
    expect(window(entry, 30000)).toBe(Infinity);
    expect(window(entry, 29999)).toBeLessThan(Infinity);
  });

  it('widens by 30 every second and caps at 1000 before the unbounded cutoff', () => {
    const entry: QueueEntry = { id: 'a', rating: 1500, rd: 30, joinedAt: 0 };
    expect(window(entry, 0)).toBe(100);
    expect(window(entry, 1000)).toBe(130);
    expect(window(entry, 2000)).toBe(160);
  });
});

describe('pairQueue', () => {
  it('does not pair two players 900 apart at t=0 but does after 30 seconds', () => {
    const a: QueueEntry = { id: 'a', rating: 1000, rd: 50, joinedAt: 0 };
    const b: QueueEntry = { id: 'b', rating: 1900, rd: 50, joinedAt: 0 };

    expect(pairQueue([a, b], 0)).toEqual([]);
    expect(pairQueue([a, b], 30000)).toEqual([[a, b]]);
  });

  it('never pairs the same entry twice and only within both windows, and pairs everyone within 60s', () => {
    const rand = mulberry32(7);
    const entries: QueueEntry[] = Array.from({ length: 50 }, (_, i) => ({
      id: `p${i}`,
      rating: 800 + Math.floor(rand() * 1400),
      rd: 30 + Math.floor(rand() * 320),
      joinedAt: Math.floor(rand() * 30000),
    }));

    const pending = new Map(entries.map((e) => [e.id, e]));
    const pairedAt = new Map<string, number>();

    for (let t = 1000; t <= 60000; t += 1000) {
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
      expect((at as number) - entry.joinedAt).toBeLessThanOrEqual(60000);
    }
  });
});

describe('groupQueue', () => {
  const entry = (id: string, rating: number, joinedAt: number, rd = 30): QueueEntry => ({ id, rating, rd, joinedAt });

  it('returns nothing until a whole group can be filled', () => {
    const entries = [entry('a', 1500, 0), entry('b', 1510, 100), entry('c', 1490, 200)];
    expect(groupQueue(entries, 6, 1000)).toEqual([]);
    expect(groupQueue(entries, 3, 1000).length).toBe(1);
  });

  it('gathers the closest-rated entries around the longest waiter', () => {
    const entries = [
      entry('anchor', 1500, 0),
      entry('far', 1580, 100),
      entry('near', 1505, 200),
      entry('mid', 1540, 300),
    ];
    const [group] = groupQueue(entries, 3, 1000);
    expect(group.map((e) => e.id)).toEqual(['anchor', 'near', 'mid']);
  });

  it('refuses a member outside another member\'s window', () => {
    // b and c are both inside a's window but 180 apart from each other,
    // which is outside their own 100-point windows.
    const entries = [entry('a', 1500, 0, 60), entry('b', 1410, 100), entry('c', 1590, 200)];
    expect(groupQueue(entries, 3, 1000)).toEqual([]);
  });

  it('takes anyone once an entry has waited past the unbounded cutoff', () => {
    const now = 31_000;
    // old's window is unbounded, but x and y joined a moment ago and their
    // own windows still have to cover the gap, so no group forms.
    const entries = [entry('old', 1500, 0), entry('x', 2400, 30_000), entry('y', 2410, 30_100)];
    expect(groupQueue(entries, 3, now)).toEqual([]);
    const patient = [entry('old', 1500, 0), entry('x', 2400, 0), entry('y', 2410, 0)];
    const [group] = groupQueue(patient, 3, now);
    expect(group.map((e) => e.id).sort()).toEqual(['old', 'x', 'y']);
  });

  it('forms several disjoint groups in one pass', () => {
    const entries = [
      entry('a1', 1500, 0),
      entry('a2', 1510, 10),
      entry('b1', 2000, 20),
      entry('b2', 2010, 30),
      entry('a3', 1520, 40),
      entry('b3', 2020, 50),
    ];
    const groups = groupQueue(entries, 3, 1000);
    expect(groups.length).toBe(2);
    const ids = groups.map((g) => g.map((e) => e.id).sort());
    expect(ids).toContainEqual(['a1', 'a2', 'a3']);
    expect(ids).toContainEqual(['b1', 'b2', 'b3']);
    expect(new Set(groups.flat().map((e) => e.id)).size).toBe(6);
  });

  it('leaves an unfillable anchor in the queue for a later anchor to use', () => {
    // `lonely` cannot fill a group of 3 on its own terms, but it is still
    // available to the pack that can.
    const entries = [
      entry('lonely', 1300, 0),
      entry('p1', 1520, 100),
      entry('p2', 1530, 200),
      entry('p3', 1540, 300),
    ];
    const groups = groupQueue(entries, 3, 1000);
    expect(groups.length).toBe(1);
    expect(groups[0].map((e) => e.id).sort()).toEqual(['p1', 'p2', 'p3']);
  });
});

describe('reach', () => {
  it('pairs and groups across any gap when told to', () => {
    const a: QueueEntry = { id: 'a', rating: 1200, rd: 50, joinedAt: 0 };
    const b: QueueEntry = { id: 'b', rating: 2200, rd: 50, joinedAt: 1 };
    const c: QueueEntry = { id: 'c', rating: 1700, rd: 50, joinedAt: 2 };
    expect(pairQueue([a, b], 0)).toEqual([]);
    expect(pairQueue([a, b], 0, anyone)).toEqual([[a, b]]);
    expect(groupQueue([a, b, c], 3, 0)).toEqual([]);
    expect(groupQueue([a, b, c], 3, 0, anyone)).toEqual([[a, c, b]]);
  });
});
