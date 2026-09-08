/* One record per puzzle type in localStorage, plus the count solved today.

   The pot odds trainer already keeps its own record under ot.odds and keeps it
   there: it shipped first and a player's streak is not worth resetting to tidy
   the key up. The daily count is a date and a number rather than a list of
   days, because the only question the index asks is how many today. */

export type PuzzleType = 'showdown' | 'preflop' | 'hand';

export const PUZZLE_TYPES: PuzzleType[] = ['showdown', 'preflop', 'hand'];

const STORE = 'ot.puzzles';

export interface Tally {
  right: number;
  total: number;
  streak: number;
  best: number;
}

export interface Puzzles {
  types: Record<PuzzleType, Tally>;
  day: string; // YYYY-MM-DD, local
  solvedToday: number;
}

const EMPTY_TALLY: Tally = { right: 0, total: 0, streak: 0, best: 0 };

export function emptyPuzzles(): Puzzles {
  return {
    types: { showdown: { ...EMPTY_TALLY }, preflop: { ...EMPTY_TALLY }, hand: { ...EMPTY_TALLY } },
    day: today(),
    solvedToday: 0,
  };
}

/* Local, not UTC: a daily count that rolls over at midnight somewhere else is
   a daily count nobody recognises. */
export function today(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function number(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function readTally(raw: unknown): Tally {
  const r = (raw ?? {}) as Partial<Tally>;
  return { right: number(r.right), total: number(r.total), streak: number(r.streak), best: number(r.best) };
}

export function parsePuzzles(raw: string | null, now = new Date()): Puzzles {
  const empty = emptyPuzzles();
  if (!raw) return empty;
  let parsed: Partial<Puzzles>;
  try {
    parsed = JSON.parse(raw) as Partial<Puzzles>;
  } catch {
    return empty;
  }
  const types = (parsed.types ?? {}) as Partial<Record<PuzzleType, unknown>>;
  const day = typeof parsed.day === 'string' ? parsed.day : today(now);
  const stale = day !== today(now);
  return {
    types: {
      showdown: readTally(types.showdown),
      preflop: readTally(types.preflop),
      hand: readTally(types.hand),
    },
    day: stale ? today(now) : day,
    solvedToday: stale ? 0 : number(parsed.solvedToday),
  };
}

export function readPuzzles(now = new Date()): Puzzles {
  try {
    return parsePuzzles(localStorage.getItem(STORE), now);
  } catch {
    return emptyPuzzles();
  }
}

export function writePuzzles(puzzles: Puzzles): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(puzzles));
  } catch {
    // A browser with storage turned off still gets to solve puzzles.
  }
}

/* One answer, folded in. A right answer is what counts towards the day: the
   strip says how many were solved, not how many were attempted. */
export function afterAnswer(puzzles: Puzzles, type: PuzzleType, right: boolean, now = new Date()): Puzzles {
  const rolled = puzzles.day === today(now) ? puzzles : { ...puzzles, day: today(now), solvedToday: 0 };
  const prev = rolled.types[type];
  const streak = right ? prev.streak + 1 : 0;
  return {
    ...rolled,
    types: {
      ...rolled.types,
      [type]: {
        right: prev.right + (right ? 1 : 0),
        total: prev.total + 1,
        streak,
        best: Math.max(prev.best, streak),
      },
    },
    solvedToday: rolled.solvedToday + (right ? 1 : 0),
  };
}

export function accuracyOf(record: Tally): number {
  return record.total === 0 ? 0 : (record.right / record.total) * 100;
}
