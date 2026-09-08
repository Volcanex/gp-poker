import type { ClientMsg } from '@opentable/protocol';
import { hub } from './hub.js';
import { enqueue, enqueuePractice, dequeue } from '../matchmaking.js';
import { getRoom, roomForPlayer, roomsForSpectator } from '../match/rooms.js';
import { unwatchArena, watchArena } from '../arena.js';

// Dispatches everything the hub hands it except `ping`, which the hub
// answers itself before this is ever called.
export function routeClientMessage(userId: string, msg: ClientMsg): void {
  switch (msg.t) {
    case 'queue': {
      const mode = msg.mode ?? 'heads-up';
      // A practice request never joins the human queue: it either gets a table
      // of bots straight away or an error saying they are all busy.
      if (msg.bots) void enqueuePractice(userId, mode, msg.bots.level);
      else void enqueue(userId, mode, msg.rated ?? true);
      return;
    }
    case 'dequeue':
      dequeue(userId);
      return;
    case 'join': {
      const room = getRoom(msg.m);
      if (!room) {
        hub.send(userId, { t: 'err', c: 'no_match', msg: 'no such match' });
        return;
      }
      room.join(userId);
      return;
    }
    case 'leave': {
      getRoom(msg.m)?.leave(userId);
      return;
    }
    case 'act': {
      const room = getRoom(msg.m);
      if (!room) {
        hub.send(userId, { t: 'err', c: 'no_match', msg: 'no such match' });
        return;
      }
      room.handleAct(userId, msg);
      return;
    }
    case 'chat': {
      const room = getRoom(msg.m);
      if (!room) {
        hub.send(userId, { t: 'err', c: 'no_match', msg: 'no such match' });
        return;
      }
      room.handleChat(userId, msg);
      return;
    }
    case 'arena':
      // Watching a board is not joining an arena: a page says which one it is
      // showing, and `null` says it has stopped showing one.
      watchArena(userId, msg.a);
      return;
    default:
      hub.send(userId, { t: 'err', c: 'bad_msg', msg: 'unknown message type' });
  }
}

export function routeConnect(userId: string): void {
  roomForPlayer(userId)?.handleReconnect(userId);
}

export function routeDisconnect(userId: string): void {
  dequeue(userId);
  unwatchArena(userId);
  roomForPlayer(userId)?.handleDisconnect(userId);
  // A player keeps their subscription through the grace window; a spectator
  // has nothing to come back to, so every table they were watching drops
  // them. Without this the subscriber set only ever grows.
  for (const room of roomsForSpectator(userId)) room.leave(userId);
}
