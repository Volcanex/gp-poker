/* Pure matchmaking: no clock, no queue storage. The server ticks pairQueue
   every second against its own queue state and applies whatever pairs
   come back. */

export interface QueueEntry {
  id: string;
  rating: number;
  rd: number;
  joinedAt: number;
}

const WINDOW_FLOOR = 100;
const WINDOW_STEP = 30;
const WINDOW_STEP_MS = 1000;
const WINDOW_CAP = 1000;
const WINDOW_UNBOUNDED_MS = 30000;

/* How far a pairing may reach in rating for an entry at this moment. The
   default is `window`, which opens with the wait; a caller that wants two
   entries paired whatever the gap passes `anyone`. */
export type Reach = (entry: QueueEntry, now: number) => number;

export const anyone: Reach = () => Infinity;

// Widens every second rather than every five: a search opens near its rating
// and is willing to take anyone at all within half a minute, on a curve a
// player watching the range tick up can actually see move.
export function window(entry: QueueEntry, now: number): number {
  const waited = now - entry.joinedAt;
  if (waited >= WINDOW_UNBOUNDED_MS) return Infinity;
  const base = Math.max(WINDOW_FLOOR, 2 * entry.rd);
  const steps = Math.floor(waited / WINDOW_STEP_MS);
  return Math.min(WINDOW_CAP, base + steps * WINDOW_STEP);
}

// Longest-waiting entries get first pick of their closest-rated match; a
// pair only forms when the rating gap sits inside both sides' windows.
// Sorting by joinedAt then id makes the result deterministic for equal
// timestamps.
export function pairQueue<T extends QueueEntry>(entries: T[], now: number, reach: Reach = window): [T, T][] {
  const ordered = [...entries].sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
  const paired = new Set<string>();
  const pairs: [T, T][] = [];

  for (const entry of ordered) {
    if (paired.has(entry.id)) continue;
    const entryWindow = reach(entry, now);

    let best: T | null = null;
    let bestDiff = Infinity;
    for (const other of ordered) {
      if (other.id === entry.id || paired.has(other.id)) continue;
      const diff = Math.abs(entry.rating - other.rating);
      if (diff > entryWindow || diff > reach(other, now)) continue;
      if (
        diff < bestDiff ||
        (diff === bestDiff && best !== null && (other.joinedAt < best.joinedAt || (other.joinedAt === best.joinedAt && other.id < best.id)))
      ) {
        best = other;
        bestDiff = diff;
      }
    }

    if (best) {
      paired.add(entry.id);
      paired.add(best.id);
      pairs.push([entry, best]);
    }
  }

  return pairs;
}

/* Multiway gathering. Repeatedly takes the longest-waiting entry as the
   anchor and gathers the closest-rated entries that sit inside the anchor's
   window and every already-gathered member's window (and theirs inside each
   other's), until the group is `size` strong. An anchor that cannot fill a
   whole group is left in the queue rather than half-consumed, so the next
   anchor can still reach it. Entries past WINDOW_UNBOUNDED_MS have an
   infinite window and so accept anyone who accepts them. */
export function groupQueue<T extends QueueEntry>(entries: T[], size: number, now: number, reach: Reach = window): T[][] {
  if (size < 2) return [];
  const ordered = [...entries].sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
  const windows = new Map(ordered.map((e) => [e.id, reach(e, now)]));
  const used = new Set<string>();
  const groups: T[][] = [];

  const compatible = (a: T, b: T): boolean => {
    const diff = Math.abs(a.rating - b.rating);
    return diff <= (windows.get(a.id) ?? 0) && diff <= (windows.get(b.id) ?? 0);
  };

  for (const anchor of ordered) {
    if (used.has(anchor.id)) continue;
    const group = [anchor];

    while (group.length < size) {
      let best: T | null = null;
      let bestDiff = Infinity;
      for (const other of ordered) {
        if (used.has(other.id) || group.includes(other)) continue;
        if (!group.every((m) => compatible(m, other))) continue;
        const diff = Math.abs(anchor.rating - other.rating);
        if (diff < bestDiff || (diff === bestDiff && best !== null && other.joinedAt < best.joinedAt)) {
          best = other;
          bestDiff = diff;
        }
      }
      if (!best) break;
      group.push(best);
    }

    if (group.length === size) {
      for (const m of group) used.add(m.id);
      groups.push(group);
    }
  }

  return groups;
}
