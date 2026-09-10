import type { TournamentShape, TournamentStatus, TournamentTable } from '@opentable/protocol';
import { countdown } from './arena-bits.ts';

/* The pure half of the tournament pages: the clock, the local start time, the
   line a card carries and the names a round goes by. It is separate for the
   reason `arena-bits.ts` is: the arithmetic of a countdown is worth testing
   without a browser in the way, and a countdown that lies is the one thing on
   these pages nobody would notice until it mattered.

   `countdown` itself is the arena's, imported rather than rewritten: two
   copies of "the largest unit that still says something" drift until they
   round differently. */

export interface TournamentTimes {
  status: TournamentStatus;
  startsAt: string;
}

/* A start time in the viewer's own zone. A tournament is a thing in somebody's
   evening rather than a moment on a clock, so the day is part of the answer:
   the daily bracket moves through three slots and one of them is the small
   hours somewhere. */
const LOCAL = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export function localStart(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? '' : LOCAL.format(at);
}

/* How long until a fixture. The arena's own `countdown` counts hours at most,
   because an arena is half an hour long and the next one is inside the hour.
   A tournament calendar reaches a month out, and "in 594 hr" is a number
   nobody can read, so days are added above two of them and everything below
   that is the arena's function unchanged. */
const DAY_MS = 24 * 60 * 60 * 1000;

export function tournamentCountdown(ms: number): string {
  const left = Math.max(0, ms);
  if (left < 2 * DAY_MS) return countdown(left);
  const days = Math.round(left / DAY_MS);
  return `${days} days`;
}

export interface TournamentClock {
  kind: 'starts' | 'playing' | 'over' | 'cancelled';
  label: string;
}

/* What a card says about time. An upcoming fixture counts down; a running one
   says so rather than counting into the negative, because a tournament ends
   when its final table settles and not when a clock says it should have. */
export function tournamentClock(t: TournamentTimes, now = Date.now()): TournamentClock {
  if (t.status === 'cancelled') return { kind: 'cancelled', label: 'Cancelled' };
  if (t.status === 'finished') return { kind: 'over', label: 'Finished' };
  if (t.status === 'running') return { kind: 'playing', label: 'Playing now' };
  const starts = new Date(t.startsAt).getTime();
  if (starts <= now) return { kind: 'starts', label: 'Starting now' };
  return { kind: 'starts', label: `Starts in ${tournamentCountdown(starts - now)}` };
}

/* How full a field is. Read as a count over a cap while there are still seats
   to take, so somebody deciding whether to register sees both what is there
   and what there is room for. Once a fixture has started the cap is no longer
   a fact about it, so the field is just its size. */
export function entrantsLabel(t: { entrants: number; seats: number; status?: TournamentStatus }): string {
  if (t.status !== undefined && t.status !== 'upcoming') {
    return `${t.entrants} ${t.entrants === 1 ? 'entrant' : 'entrants'}`;
  }
  return `${t.entrants} of ${t.seats} entered`;
}

export function shapeLabel(shape: TournamentShape): string {
  return shape === 'bracket' ? 'Heads-up bracket' : 'Six-max shootout';
}

/* What a round is called. A round with one table is the final whichever shape
   it is.

   A bracket can say what it is out of while it is still running, because its
   depth is a fact about its first round: a bracket that starts with n matches
   is log2(n) + 1 rounds long, whatever happens in them. A shootout cannot,
   because how many tables the next round has depends on how many people come
   through this one, so it counts up and says nothing it does not know. */
export function roundName(rounds: TournamentTable[][], round: number, shape?: TournamentShape): string {
  const tables = rounds[round - 1] ?? [];
  if (tables.length === 1) return 'Final';
  if (tables.length === 2) return 'Semi-finals';
  const first = rounds[0]?.length ?? 0;
  const total = shape === 'bracket' && first > 0 ? Math.log2(first) + 1 : rounds.length;
  return total > round ? `Round ${round} of ${total}` : `Round ${round}`;
}

/* Where the tournament is up to, in one phrase. The registration state says
   what to do rather than what is happening, because before the start there is
   nothing happening. */
export function progressLabel(t: {
  status: TournamentStatus;
  round: number;
  rounds: TournamentTable[][];
  shape?: TournamentShape;
}): string {
  if (t.status === 'upcoming') return 'Registration open';
  if (t.status === 'cancelled') return 'Not enough entrants';
  if (t.status === 'finished') return 'Finished';
  return roundName(t.rounds, t.round, t.shape);
}

/* A seat's own line on a table card: where it came and whether that took it
   through. Null while the table is still to be played, which the card draws as
   nothing rather than as a nought. */
export function seatOutcome(seat: { place: number | null; advanced: boolean }): string | null {
  if (seat.place === null) return null;
  return seat.advanced ? `${seat.place}, through` : String(seat.place);
}

/* Whether this fixture's page should draw a bracket rather than a funnel. One
   predicate, because three places ask it. */
export function isBracket(shape: TournamentShape): boolean {
  return shape === 'bracket';
}
