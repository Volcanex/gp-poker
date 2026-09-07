import type { Match, MatchHandSummary, Profile } from './types.ts';

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
