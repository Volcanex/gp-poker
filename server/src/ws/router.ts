import { DEFAULT_MODE, DEFAULT_SPEED, type ClientMsg, type Speed } from '@opentable/protocol';
import { hub } from './hub.js';
import { dequeue, dequeueOnDisconnect, enqueue, enqueuePractice } from '../matchmaking.js';
import { respondReady } from '../ready.js';
import { getRoom, roomForPlayer, roomsForSpectator } from '../match/rooms.js';
import { unwatchArena, watchArena } from '../arena.js';

// Dispatches everything the hub hands it except `ping`, which the hub
// answers itself before this is ever called.
//
// `next` is the practice hold's un-hold: sent by the human seat once they
// have looked at a finished hand, so the table deals the next one (or
// finishes the match) instead of waiting out the safety timeout.
//
// `back` is the sit-out's un-sit, and it is a message rather than an action
// for the same shape of reason: a sat-out player cannot say it by acting,
// because their decision is folded before they can reach it.
//
// `leave` and `resign` are two different things and the difference matters:
// `leave` drops a subscription and is sent by a page going away, `resign`
// ends the player's game and is sent by a button they pressed.
export function routeClientMessage(userId: string, msg: ClientMsg): void {
  switch (msg.t) {
    case 'queue': {
      const mode = msg.mode ?? DEFAULT_MODE;
      const speed: Speed = msg.speed === 'fast' ? 'fast' : DEFAULT_SPEED;
      // A practice request never joins the human queue: it either gets a table
      // of bots straight away or an error saying they are all busy. It skips
      // the ready check too, for the same reason: nobody is waiting on you at
      // a table you asked for a second ago.
      if (msg.bots) void enqueuePractice(userId, mode, msg.bots.level, speed);
      else void enqueue(userId, mode, msg.rated ?? true, speed);
      return;
    }
    case 'ready':
      // Which table is not on the message: a player is only ever offered one
      // at a time, so the server knows, and a client cannot answer a check
      // that has already been settled by somebody else.
      respondReady(userId, msg.a === true);
      return;
    case 'dequeue':
      dequeue(userId);
      return;
    case 'join': {
      const room = getRoom(msg.m);
      if (!room) {
        hub.send(userId, { t: 'err', c: 'no_match', msg: 'No such match' });
        return;
      }
      room.join(userId);
      return;
    }
    case 'leave': {
      getRoom(msg.m)?.leave(userId);
      return;
    }
    // Leaving the game, not the page. `leave` above is the unsubscribe every
    // unmount sends and must never end a match; this is the table's own
    // control, and what it costs is the room's to decide.
    case 'resign': {
      const room = getRoom(msg.m);
      if (!room) {
        hub.send(userId, { t: 'err', c: 'no_match', msg: 'No such match' });
        return;
      }
      room.handleResign(userId);
      return;
    }
    case 'act': {
      const room = getRoom(msg.m);
      if (!room) {
        hub.send(userId, { t: 'err', c: 'no_match', msg: 'No such match' });
        return;
      }
      room.handleAct(userId, msg);
      return;
    }
    case 'next': {
      const room = getRoom(msg.m);
      if (!room) {
        hub.send(userId, { t: 'err', c: 'no_match', msg: 'No such match' });
        return;
      }
      room.handleNext(userId, msg);
      return;
    }
    case 'back': {
      const room = getRoom(msg.m);
      if (!room) {
        hub.send(userId, { t: 'err', c: 'no_match', msg: 'No such match' });
        return;
      }
      room.handleBack(userId, msg);
      return;
    }
    case 'chat': {
      const room = getRoom(msg.m);
      if (!room) {
        hub.send(userId, { t: 'err', c: 'no_match', msg: 'No such match' });
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
      hub.send(userId, { t: 'err', c: 'bad_msg', msg: 'Unknown message type' });
  }
}

export function routeConnect(userId: string): void {
  roomForPlayer(userId)?.handleReconnect(userId);
}

export function routeDisconnect(userId: string): void {
  dequeueOnDisconnect(userId);
  unwatchArena(userId);
  roomForPlayer(userId)?.handleDisconnect(userId);
  // A player keeps their subscription through the grace window; a spectator
  // has nothing to come back to, so every table they were watching drops
  // them. Without this the subscriber set only ever grows.
  for (const room of roomsForSpectator(userId)) room.leave(userId);
}
