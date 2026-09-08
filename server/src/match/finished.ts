import type { MatchFormat, MatchResult } from '@opentable/protocol';

/* The one place a finished match is announced inside the process.

   A match room knows how to play poker and how to persist a result. It does
   not know what an arena is, and it should not have to: the arena is one
   reader of "this match ended", and a table that imported the scoreboard would
   have to import the next thing that wants to hear too. So the room emits and
   whoever cares listens, the same injection `setBotDispatch` uses to keep the
   bots out of the websocket layer.

   Listeners run from `finishMatch`, which is itself called from a timer nobody
   awaits, so a rejection here is caught and logged rather than allowed to
   reach the process and take every live match with it. */

export interface FinishedMatch {
  id: string;
  format: MatchFormat;
  playerIds: string[]; // seat order
  winner: string | null; // null on a draw
  reason: MatchResult['reason'];
  places: Record<string, number>; // 1 = winner; a heads-up draw gives both 1
}

export type FinishedListener = (match: FinishedMatch) => void | Promise<void>;

const listeners = new Set<FinishedListener>();

export function onMatchFinished(fn: FinishedListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Exported for tests that want a clean process between suites.
export function clearMatchFinishedListeners(): void {
  listeners.clear();
}

export function emitMatchFinished(match: FinishedMatch): void {
  for (const fn of listeners) {
    try {
      const result = fn(match);
      if (result) result.catch((err) => console.error(`match ${match.id} finished listener failed:`, err));
    } catch (err) {
      console.error(`match ${match.id} finished listener failed:`, err);
    }
  }
}
