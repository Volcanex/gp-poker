import type { MatchRoom } from './room.js';

const byId = new Map<string, MatchRoom>();
const byPlayer = new Map<string, MatchRoom>();
// Spectators, unlike players, are not tied to one room for the life of a
// match: a user can be watching several tables from several tabs. Kept here
// so a disconnect can drop every subscription that user holds without
// scanning every live room for them.
const bySpectator = new Map<string, Set<MatchRoom>>();

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
  for (const uid of room.spectatorIds) untrackSpectator(uid, room);
}

export function trackSpectator(userId: string, room: MatchRoom): void {
  let rooms = bySpectator.get(userId);
  if (!rooms) {
    rooms = new Set();
    bySpectator.set(userId, rooms);
  }
  rooms.add(room);
}

export function untrackSpectator(userId: string, room: MatchRoom): void {
  const rooms = bySpectator.get(userId);
  if (!rooms) return;
  rooms.delete(room);
  if (rooms.size === 0) bySpectator.delete(userId);
}

// Every room this user is watching. A copy, because the caller drops them
// from each room and that mutates the set this reads from.
export function roomsForSpectator(userId: string): MatchRoom[] {
  return [...(bySpectator.get(userId) ?? [])];
}

export function getRoom(matchId: string): MatchRoom | undefined {
  return byId.get(matchId);
}

export function roomForPlayer(userId: string): MatchRoom | undefined {
  return byPlayer.get(userId);
}

// Every match still being played. A finished room lingers a minute before it
// is unregistered, so this asks each one whether it is active rather than
// treating registration as liveness. The ladder reads it to find out whether
// a person is at a table anywhere before it starts a bot-only one.
export function liveRooms(): MatchRoom[] {
  return [...byId.values()].filter((room) => room.active);
}
