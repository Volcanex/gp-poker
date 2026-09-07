import { updateRating, widenRd } from '@opentable/rating';

export interface PlayerRatingInput {
  userId: string;
  rating: number;
  rd: number;
  volatility: number;
  ratingAt: Date;
}

export interface RatingUpdate {
  before: number;
  after: number;
  rdBefore: number;
  rdAfter: number;
  volatility: number;
}

function daysSince(date: Date, now: number): number {
  return Math.max(0, (now - date.getTime()) / 86_400_000);
}

// Widens each player's RD for their own inactivity first (Glicko-2's model
// for "we're less sure about you the longer it's been"), then runs the
// head-to-head update both ways. `before`/`rdBefore` report the actual
// persisted pre-match values, not the widened ones — widening is an input
// to the algorithm, not something that happened to the player's record.
export function computeMatchRatings(
  a: PlayerRatingInput,
  b: PlayerRatingInput,
  scoreForA: 0 | 0.5 | 1
): Record<string, RatingUpdate> {
  const now = Date.now();
  const widenedA = widenRd({ rating: a.rating, rd: a.rd, volatility: a.volatility }, daysSince(a.ratingAt, now));
  const widenedB = widenRd({ rating: b.rating, rd: b.rd, volatility: b.volatility }, daysSince(b.ratingAt, now));
  const scoreForB: 0 | 0.5 | 1 = scoreForA === 1 ? 0 : scoreForA === 0 ? 1 : 0.5;

  const afterA = updateRating(widenedA, [{ rating: widenedB.rating, rd: widenedB.rd, score: scoreForA }]);
  const afterB = updateRating(widenedB, [{ rating: widenedA.rating, rd: widenedA.rd, score: scoreForB }]);

  return {
    [a.userId]: { before: a.rating, after: afterA.rating, rdBefore: a.rd, rdAfter: afterA.rd, volatility: afterA.volatility },
    [b.userId]: { before: b.rating, after: afterB.rating, rdBefore: b.rd, rdAfter: afterB.rd, volatility: afterB.volatility },
  };
}
