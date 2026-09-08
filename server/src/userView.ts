import { isProvisional as ratingIsProvisional } from '@opentable/rating';
import type { MatchResult, Mode, ModeRating, UserSummary } from '@opentable/protocol';
import { MODES, type RatingRow, type UserRow } from './db.js';

// Defers to @opentable/rating's own threshold rather than keeping a second
// constant here that could drift from it.
export function isProvisional(rating: Pick<RatingRow, 'rating' | 'rd' | 'volatility'>): boolean {
  return ratingIsProvisional(rating);
}

export function toModeRating(row: RatingRow): ModeRating {
  return {
    rating: Math.round(row.rating),
    rd: Math.round(row.rd),
    provisional: isProvisional(row),
    peak: Math.round(row.peakRating),
    peakAt: row.peakAt ? row.peakAt.toISOString() : null,
    matches: row.matches,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
  };
}

/* The mode this player actually plays: whichever they have the most rated
   matches in, the higher rating breaking a tie, heads-up when they have played
   neither. It is what the profile puts in its headline, so it answers "where do
   you play" rather than "where are you best": somebody who ground out two
   hundred heads-up matches is a heads-up player even on a day their six-max
   rating happens to read higher. */
export function mainMode(ratings: Record<Mode, RatingRow>): Mode {
  return MODES.reduce((best, mode) => {
    if (ratings[mode].matches !== ratings[best].matches) {
      return ratings[mode].matches > ratings[best].matches ? mode : best;
    }
    return ratings[mode].rating > ratings[best].rating ? mode : best;
  }, MODES[0]);
}

// The flat rating/rd/provisional fields are the heads-up standing. They stay
// on the wire so a caller that only wants "the" rating still has one; the
// `ratings` map is the honest answer.
export function toUserSummary(user: UserRow, ratings: Record<Mode, RatingRow>): UserSummary {
  const map = {} as Record<Mode, ModeRating>;
  for (const mode of MODES) map[mode] = toModeRating(ratings[mode]);
  const headsUp = map['heads-up'];
  return {
    id: user.id,
    name: user.name,
    guest: user.guest,
    bot: user.bot,
    // Only a bot has one, and a person's summary should not carry the key at
    // all rather than carry a null.
    ...(user.botLevel != null ? { botLevel: user.botLevel } : {}),
    rating: headsUp.rating,
    rd: headsUp.rd,
    provisional: headsUp.provisional,
    ratings: map,
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
