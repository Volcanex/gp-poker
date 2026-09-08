import type { Mode, UserSummary } from '@opentable/protocol';
import {
  cancelOpenChallenge,
  claimChallenge,
  countOpenChallenges,
  getChallengeById,
  getRatingsFor,
  getUserById,
  insertChallenge,
  releaseChallenge,
  setChallengeMatch,
  type ChallengeRow,
} from './db.js';
import { createMatchForPlayers, matchFormat, randomMatchId } from './matchmaking.js';
import { roomForPlayer } from './match/rooms.js';
import { toUserSummary } from './userView.js';
import { isUniqueViolation } from './pgError.js';

/* Play a friend: a link instead of a queue. The creator asks for one, sends
   it to whoever they want to play, and the match is created the moment that
   person opens it and accepts. Both sides are told the same way a queue match
   tells them (`q found`), so the creator's waiting page navigates to the
   table without knowing a challenge existed.

   Heads-up only for now. A six-max link would have to gather six people
   rather than two, which is a different feature (a lobby) wearing the same
   word, and the UI says so rather than quietly starting a heads-up match. */

export const CHALLENGE_TTL_MS = 24 * 60 * 60 * 1000;

// Enough to have a link out to a few people at once, low enough that a page
// reloaded twenty times does not leave twenty live links behind.
export const MAX_OPEN_CHALLENGES = 5;

export type ChallengeStatus = 'open' | 'accepted' | 'cancelled' | 'expired';

export interface ChallengeView {
  id: string;
  mode: Mode;
  rated: boolean;
  status: ChallengeStatus;
  creator: UserSummary;
  matchId: string | null;
  createdAt: Date;
  expiresAt: Date;
}

type Refusal = { ok: false; status: number; error: string };

/* The stored status never says expired: a link that ran out of time is one
   nobody has cancelled and nobody has taken, and the clock is the only thing
   that changed. Deriving it here is what keeps the table free of rows a sweep
   would have had to correct. */
export function statusOf(row: ChallengeRow, now = Date.now()): ChallengeStatus {
  if (row.status === 'open' && row.expiresAt.getTime() <= now) return 'expired';
  return row.status;
}

export async function createChallenge(
  creatorId: string,
  mode: Mode,
  rated: boolean
): Promise<{ ok: true; row: ChallengeRow } | Refusal> {
  if (mode !== 'heads-up') {
    return { ok: false, status: 400, error: 'Only heads-up challenges can be shared for now' };
  }
  const open = await countOpenChallenges(creatorId);
  if (open >= MAX_OPEN_CHALLENGES) {
    return {
      ok: false,
      status: 429,
      error: `You already have ${MAX_OPEN_CHALLENGES} links waiting. Cancel one to make another.`,
    };
  }

  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
  // Same retry-on-collision loop as a match id, for the same reason: the id is
  // short enough to be read aloud, so a collision is rare rather than
  // impossible.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return { ok: true, row: await insertChallenge(randomMatchId(), creatorId, mode, rated, expiresAt) };
    } catch (err) {
      if (isUniqueViolation(err)) continue;
      throw err;
    }
  }
  throw new Error('could not allocate a unique challenge id');
}

/* What the link's page renders: who is challenging you, in what format, and
   whether the link is still worth anything. The creator's summary carries the
   per-mode rating, so the page can say what they are rated at without a
   second call. */
export async function challengeView(id: string): Promise<ChallengeView | null> {
  const row = await getChallengeById(id);
  if (!row) return null;
  const creator = await getUserById(row.creatorId);
  if (!creator) return null;
  return {
    id: row.id,
    mode: row.mode,
    rated: row.rated,
    status: statusOf(row),
    creator: toUserSummary(creator, await getRatingsFor(creator.id)),
    matchId: row.matchId,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

const TAKEN = 'This challenge was already taken';

export async function acceptChallenge(
  id: string,
  userId: string
): Promise<{ ok: true; matchId: string } | Refusal> {
  const row = await getChallengeById(id);
  if (!row) return { ok: false, status: 404, error: 'No such challenge' };
  if (row.creatorId === userId) {
    return { ok: false, status: 400, error: 'This is your own link. Send it to the friend you want to play.' };
  }

  const state = statusOf(row);
  if (state === 'accepted') return { ok: false, status: 409, error: TAKEN };
  if (state === 'cancelled') return { ok: false, status: 409, error: 'This challenge was cancelled' };
  if (state === 'expired') return { ok: false, status: 410, error: 'This link has expired' };

  // A person can only be at one table at a time, and a link that seated
  // somebody twice would abandon the match they are already playing.
  if (roomForPlayer(userId)) {
    return { ok: false, status: 409, error: 'You are already in a match. Finish it before starting another.' };
  }
  if (roomForPlayer(row.creatorId)) {
    const creator = await getUserById(row.creatorId);
    return {
      ok: false,
      status: 409,
      error: `${creator?.name ?? 'that player'} is in a match right now. The link still works once it is over.`,
    };
  }

  const claimed = await claimChallenge(id, userId);
  if (!claimed) return { ok: false, status: 409, error: TAKEN };

  // Seat order decides who takes the button first, so it is a coin flip
  // rather than a standing advantage for whoever sent the link.
  const seats =
    Math.random() < 0.5 ? [claimed.creatorId, userId] : [userId, claimed.creatorId];
  try {
    const matchId = await createMatchForPlayers(seats, matchFormat(claimed.mode, claimed.rated));
    await setChallengeMatch(id, matchId);
    return { ok: true, matchId };
  } catch (err) {
    // The link was claimed for a match that never came into being; giving it
    // back is better than eating it over a database error.
    await releaseChallenge(id);
    throw err;
  }
}

export async function cancelChallenge(id: string, userId: string): Promise<{ ok: true } | Refusal> {
  const row = await getChallengeById(id);
  if (!row) return { ok: false, status: 404, error: 'No such challenge' };
  if (row.creatorId !== userId) return { ok: false, status: 403, error: 'Only the person who made this link can cancel it' };
  const cancelled = await cancelOpenChallenge(id, userId);
  if (!cancelled) {
    const state = statusOf(row);
    if (state === 'accepted') return { ok: false, status: 409, error: TAKEN };
    return { ok: true }; // already cancelled, or expired: either way it is spent
  }
  return { ok: true };
}
