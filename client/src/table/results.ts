import type { Match, MatchSeat } from '../net/types.ts';

export interface ResultRow {
  seat: MatchSeat;
  place: number; // recorded finishing position, or the position this ordering puts them in
  recorded: boolean;
  stack: number;
  rating: { before: number; after: number; rdBefore: number; rdAfter: number } | null;
}

/* The finishing order. A multiway match carries `places` and that is the
   answer; a match without them (a heads-up row written before places existed)
   falls back to the winner first and then the deepest stack, which is the same
   order for the two-player case it has to cover. */
export function rankSeats(match: Match): ResultRow[] {
  const rows = match.seats.map((seat) => ({
    seat,
    place: match.places?.[seat.userId] ?? null,
    stack: match.finalStacks?.[seat.userId] ?? 0,
    rating: match.ratings?.[seat.userId] ?? null,
  }));

  rows.sort((a, b) => {
    if (a.place != null && b.place != null) {
      if (a.place !== b.place) return a.place - b.place;
    } else if (a.place != null || b.place != null) {
      return a.place != null ? -1 : 1;
    }
    const won = (r: (typeof rows)[number]) => (match.winner != null && match.winner === r.seat.userId ? 0 : 1);
    if (won(a) !== won(b)) return won(a) - won(b);
    if (a.stack !== b.stack) return b.stack - a.stack;
    return a.seat.seat - b.seat.seat;
  });

  return rows.map((r, i) => ({
    seat: r.seat,
    place: r.place ?? i + 1,
    recorded: r.place != null,
    stack: r.stack,
    rating: r.rating,
  }));
}

/* Who left, on a match whose reason is `left`. The server places the person
   who leaves last among the seats that still had chips when they did, so the
   answer is the worst-placed row that finished with a stack: everybody below
   them had already been eliminated and finished before any of this. Null on
   every other reason, and on a row too old to carry stacks.

   Derived rather than recorded because the result already says it. A `who
   left` field on the wire would be a second answer to a question `places`
   and `finalStacks` between them have only one answer to. */
export function leaverOf(match: Match): MatchSeat | null {
  if (match.reason !== 'left') return null;
  const live = rankSeats(match).filter((r) => r.stack > 0);
  return live.length > 0 ? live[live.length - 1].seat : null;
}
