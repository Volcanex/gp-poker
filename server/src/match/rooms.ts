import type { MatchRoom } from './room.js';

const byId = new Map<string, MatchRoom>();
const byPlayer = new Map<string, MatchRoom>();

export function registerRoom(room: MatchRoom): void {
  byId.set(room.id, room);
  for (const uid of room.playerIds) byPlayer.set(uid, room);
}

export function unregisterRoom(matchId: string): void {
  const room = byId.get(matchId);
  if (!room) return;
  byId.delete(matchId);
  for (const uid of room.playerIds) {
    if (byPlayer.get(uid) === room) byPlayer.delete(uid);
  }
}

export function getRoom(matchId: string): MatchRoom | undefined {
  return byId.get(matchId);
}

export function roomForPlayer(userId: string): MatchRoom | undefined {
  return byPlayer.get(userId);
}
