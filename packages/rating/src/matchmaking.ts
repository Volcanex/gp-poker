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
const WINDOW_STEP = 50;
const WINDOW_STEP_MS = 5000;
const WINDOW_CAP = 1000;
const WINDOW_UNBOUNDED_MS = 60000;

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
export function pairQueue(entries: QueueEntry[], now: number): [QueueEntry, QueueEntry][] {
  const ordered = [...entries].sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
  const paired = new Set<string>();
  const pairs: [QueueEntry, QueueEntry][] = [];

  for (const entry of ordered) {
    if (paired.has(entry.id)) continue;
    const entryWindow = window(entry, now);

    let best: QueueEntry | null = null;
    let bestDiff = Infinity;
    for (const other of ordered) {
      if (other.id === entry.id || paired.has(other.id)) continue;
      const diff = Math.abs(entry.rating - other.rating);
      if (diff > entryWindow || diff > window(other, now)) continue;
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
