import {
  banRemainingText,
  walkoutBanMs,
  walkoutStrikesNow,
} from '@opentable/protocol';
import { getUserById, recordWalkout } from './db.js';

/* Walkouts and the ranked bans they earn.

   This is `ready.ts`'s opposite number and is deliberately shaped like it:
   one file that knows what a walkout costs and nothing about where it
   happened, so the room that ends a match, the queue, the arena, the
   challenge link and the home game all ask the same question of it.

   The one thing it does not share with `ready.ts` is where the state lives.
   A ready-check cooldown is held in memory on the argument that a penalty
   nobody could see the reason for should not survive a deploy. A walkout is
   the other case: it is a decision about a match somebody was already in and
   left, the other player lost their game over it, and a deploy is not an
   amnesty. So it is columns on `users` (see `../db/schema.sql`).

   Nothing sweeps the strikes. `walkoutStrikesNow` in the protocol takes the
   stored count and the moment it was written and subtracts a strike for
   every whole day since, which is the same answer a nightly job would reach
   and is true the instant it is asked. */

export interface WalkoutState {
  /* Strikes as they stand now, decay already applied. */
  strikes: number;
  /* When the ban ends, or null when there is none running. */
  banUntil: number | null;
}

const CLEAR: WalkoutState = { strikes: 0, banUntil: null };

export async function walkoutState(userId: string, now = Date.now()): Promise<WalkoutState> {
  const user = await getUserById(userId);
  if (!user) return CLEAR;
  const strikes = walkoutStrikesNow(user.walkoutStrikes, user.walkoutAt?.getTime() ?? null, now);
  const until = user.rankedBanUntil?.getTime() ?? null;
  return { strikes, banUntil: until !== null && until > now ? until : null };
}

/* When this player may play ranked again, or null when they may now. The one
   question every ranked door asks. */
export async function rankedBanUntil(userId: string, now = Date.now()): Promise<number | null> {
  return (await walkoutState(userId, now)).banUntil;
}

/* Charge a walkout. The strike lands on the decayed count rather than on the
   stored one, so somebody who walked out three times last week and once
   today is on one strike and not four.

   Bots are never charged: a bot forfeited by the clock is a bug in the bot,
   and banning it from ranked would take it out of the roster the queue fills
   tables from. */
export async function chargeWalkout(userId: string, now = Date.now()): Promise<WalkoutState> {
  const user = await getUserById(userId);
  if (!user || user.bot) return CLEAR;
  const strikes = walkoutStrikesNow(user.walkoutStrikes, user.walkoutAt?.getTime() ?? null, now) + 1;
  const banMs = walkoutBanMs(strikes);
  /* A ban already running is never shortened by a fresh walkout: the ladder
     only ever climbs, and the second strike's five minutes must not undercut
     an eight hour ban somebody is halfway through. */
  const running = user.rankedBanUntil?.getTime() ?? 0;
  const until = Math.max(banMs > 0 ? now + banMs : 0, running > now ? running : 0);
  await recordWalkout(userId, strikes, new Date(now), until > 0 ? new Date(until) : null);
  return { strikes, banUntil: until > now ? until : null };
}

/* What a refused ranked door says. It names the reason and the moment it
   stops applying, because a refusal that only says no leaves somebody
   pressing the same button. */
export function rankedBanMessage(until: number, now = Date.now()): string {
  return `You left a ranked match. Ranked opens again in ${banRemainingText(until, now)}.`;
}
