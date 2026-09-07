import type { ClientMsg } from '@opentable/protocol';
import { hub } from './hub.js';
import { enqueue, dequeue } from '../matchmaking.js';
import { getRoom, roomForPlayer } from '../match/rooms.js';

// Dispatches everything the hub hands it except `ping`, which the hub
// answers itself before this is ever called.
export function routeClientMessage(userId: string, msg: ClientMsg): void {
  switch (msg.t) {
    case 'queue':
      void enqueue(userId, msg.mode ?? 'heads-up', msg.rated ?? true);
      return;
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
    default:
      hub.send(userId, { t: 'err', c: 'bad_msg', msg: 'unknown message type' });
  }
}

export function routeConnect(userId: string): void {
  roomForPlayer(userId)?.handleReconnect(userId);
}

export function routeDisconnect(userId: string): void {
  dequeue(userId);
  roomForPlayer(userId)?.handleDisconnect(userId);
}
