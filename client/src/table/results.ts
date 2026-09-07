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
