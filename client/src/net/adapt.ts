import type { Hand, Match, MatchHandSummary, MatchSeat, Profile, UserMatchSummary } from './types.ts';

/* Fields the server is adding but has not shipped yet: mean preflop accuracy
   and a total match count on /api/users/:name, and per-seat accuracy on the
   hands list of /api/matches/:id. Every reader goes through this file, so when
   the field names are confirmed there is one place to change and the UI above
   never learns a name. Absent and null both mean "no number to show", and the
   caller hides its tile or column rather than printing a zero. */

export function profileAccuracy(profile: Profile): number | null {
  return num(profile.accuracy);
}

/* The total, not the length of `lastMatches`, which is capped at twenty. */
export function profileMatchCount(profile: Profile): number | null {
  return num(profile.matches);
}

/* Per-seat accuracy may arrive keyed by seat or indexed by seat; both read the
   same way here, so whichever the server picks needs no change upstream. */
export function handAccuracy(hand: MatchHandSummary, seat: number): number | null {
  const source = hand.accuracy;
  if (source == null) return null;
  return num(Array.isArray(source) ? source[seat] : source[seat] ?? source[String(seat) as unknown as number]);
}

/* True once any hand in the match carries an accuracy for any seat: the column
   appears with the data and stays away until then. */
export function matchHasAccuracy(match: Match): boolean {
  return match.hands.some((h) => match.seats.some((s) => handAccuracy(h, s.seat) != null));
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/* Seats the server has not flagged yet are people, not bots: the mark appears
   with the field and stays away until then. */
export function seatIsBot(seat: MatchSeat): boolean {
  return seat.bot === true;
}

/* A finishing position only reads as one with the size of the table beside it,
   so both fields have to be there before "1st of 6" can be said at all. */
export function matchPlacing(m: UserMatchSummary): { place: number; players: number } | null {
  const place = num(m.place);
  const players = num(m.players);
  if (place == null || players == null || place < 1 || players < 2) return null;
  return { place, players };
}

/* Absent is not "casual": a row that predates the field says nothing about
   which it was, and the tag stays off. */
export function matchRated(m: UserMatchSummary): boolean | null {
  return typeof m.rated === 'boolean' ? m.rated : null;
}

/* Engine seat index to table seat. A heads-up hand row carries no map because
   the two have always been the same thing, so the identity is the fallback. */
export function liveSeats(hand: Hand): number[] {
  const map = hand.live_seats;
  if (Array.isArray(map) && map.length > 0 && map.every((n) => Number.isInteger(n))) return map;
  return hand.seats.map((_, i) => i);
}

/* Starting stacks indexed the way the engine wants them, by live seat. The row
   holds one per table seat once a table is bigger than the hand (players are
   already out), and one per player otherwise; both read the same way for the
   heads-up rows, which is the only shape written so far. */
export function startStacks(hand: Hand, seatMap: number[]): number[] {
  const perTableSeat = hand.stacksStart.length > seatMap.length;
  return seatMap.map((seat, engineIndex) => hand.stacksStart[perTableSeat ? seat : engineIndex] ?? 0);
}
