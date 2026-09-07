import { isProvisional as ratingIsProvisional } from '@opentable/rating';
import type { UserSummary } from '@opentable/protocol';
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
