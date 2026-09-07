import { isProvisional as ratingIsProvisional } from '@opentable/rating';
import type { MatchResult, UserSummary } from '@opentable/protocol';
import type { UserRow } from './db.js';

// Defers to @opentable/rating's own threshold rather than keeping a second
// constant here that could drift from it.
export function isProvisional(user: Pick<UserRow, 'rating' | 'rd' | 'volatility'>): boolean {
  return ratingIsProvisional(user);
}

export function toUserSummary(user: UserRow): UserSummary {
  return {
    id: user.id,
    name: user.name,
    guest: user.guest,
    rating: Math.round(user.rating),
    rd: Math.round(user.rd),
    provisional: isProvisional(user),
  };
}

// The database keeps full Glicko-2 precision (matches.ratings,
// rating_history, users.rating/rd) since that's what feeds the next match's
// update; every wire and REST surface rounds to an integer at the boundary
// instead, one call to this so nowhere else has to remember to.
type RatingChange = MatchResult['ratings'][string];

export function roundRatingChange(r: RatingChange): RatingChange {
  return {
    before: Math.round(r.before),
    after: Math.round(r.after),
    rdBefore: Math.round(r.rdBefore),
    rdAfter: Math.round(r.rdAfter),
  };
}

export function roundRatings(ratings: MatchResult['ratings']): MatchResult['ratings'] {
  const rounded: MatchResult['ratings'] = {};
  for (const [uid, r] of Object.entries(ratings)) rounded[uid] = roundRatingChange(r);
  return rounded;
}
