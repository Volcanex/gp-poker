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

function scoreFor(myPlace: number, theirPlace: number): 0 | 0.5 | 1 {
  if (myPlace < theirPlace) return 1;
  if (myPlace > theirPlace) return 0;
  return 0.5;
}

// One Glicko-2 rating period per player per match, holding a result against
// every other seat: 1 for a better finishing place, 0 for a worse one, 0.5
// for the same. Heads-up that reduces to exactly the old win/loss/draw
// update; six seats give each player five results in the one period, which
// is what stops a sit-and-go from being scored as five separate matches.
//
// Each player's RD is widened for their own inactivity first (Glicko-2's
// model for "we are less sure about you the longer it has been"), and every
// opponent is fed in at their widened rating too. `before`/`rdBefore` report
// the actual persisted pre-match values, not the widened ones: widening is
// an input to the algorithm, not something that happened to the record.
//
// A casual match returns an echo (after === before) and is never persisted
// as a rating change; the caller still shows it so the client can render the
// same shape either way.
export function computeMatchRatings(
  players: PlayerRatingInput[],
  places: Record<string, number>,
  rated: boolean
): Record<string, RatingUpdate> {
  const out: Record<string, RatingUpdate> = {};

  if (!rated) {
    for (const p of players) {
      out[p.userId] = { before: p.rating, after: p.rating, rdBefore: p.rd, rdAfter: p.rd, volatility: p.volatility };
    }
    return out;
  }

  const now = Date.now();
  const widened = new Map(
    players.map((p) => [
      p.userId,
      widenRd({ rating: p.rating, rd: p.rd, volatility: p.volatility }, daysSince(p.ratingAt, now)),
    ])
  );

  for (const p of players) {
    const me = widened.get(p.userId)!;
    const myPlace = places[p.userId] ?? players.length;
    const results = players
      .filter((o) => o.userId !== p.userId)
      .map((o) => {
        const them = widened.get(o.userId)!;
        return { rating: them.rating, rd: them.rd, score: scoreFor(myPlace, places[o.userId] ?? players.length) };
      });
    const after = updateRating(me, results);
    out[p.userId] = {
      before: p.rating,
      after: after.rating,
      rdBefore: p.rd,
      rdAfter: after.rd,
      volatility: after.volatility,
    };
  }

  return out;
}
