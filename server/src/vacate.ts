import { dequeue } from './matchmaking.js';
import { roomForPlayer } from './match/rooms.js';
import { getUserById } from './db.js';

/* A game two people have arranged (a challenge link, a home game) outranks
   whatever either of them was doing alone. Two people trying to meet at a
   table kept missing each other: one of them would be searching, or already
   dealt in against a bot by the queue's own fill, and the link answered
   "in a match right now" until that table was over, by which time the other
   one had started something too. So before such a game is created, everybody
   it seats is pulled out of the queue and out of any table where nobody else
   is a person, with no walkout charged, since no person is left waiting. A
   table with another person at it is still theirs to finish: the refusal
   names who, and the link keeps working. */
export type Vacated = { ok: true } | { ok: false; status: number; error: string };

export async function vacateFor(userIds: string[], caller: string): Promise<Vacated> {
  for (const id of userIds) {
    const room = roomForPlayer(id);
    if (room?.active && room.otherHumans(id)) {
      if (id === caller) {
        return { ok: false, status: 409, error: 'You are already in a match with somebody. Finish it before starting another.' };
      }
      const user = await getUserById(id);
      return {
        ok: false,
        status: 409,
        error: `${user?.name ?? 'That player'} is in a match with somebody right now. The link still works once it is over.`,
      };
    }
  }
  for (const id of userIds) {
    dequeue(id);
    const room = roomForPlayer(id);
    if (room?.active) room.vacate(id);
  }
  return { ok: true };
}
