import {
  READY_CHECK_MS,
  READY_COOLDOWN_WINDOW_MS,
  readyCooldownMs,
  speedOf,
  type MatchFormat,
  type ReadyFailure,
} from '@opentable/protocol';
import { hub } from './ws/hub.js';

/* The ready check: the twenty seconds between a table being gathered and it
   being dealt, in which everybody sitting at it has to say they are there.

   It is here rather than in `matchmaking.ts` because it is not about the
   queue. Anything that seats strangers who have not looked at their screen in
   four minutes wants one, so this file knows how a check runs and nothing at
   all about where the players came from: the caller hands it the people, a
   way to start the table and a way to be told the table died. The arena uses
   the same machinery with a different consequence for the person who did not
   answer.

   Nothing here is persisted. A restart drops every pending check and every
   cooldown, which is the same bargain the queue makes: clients re-queue, and
   a cooldown that survives a deploy would be a punishment nobody could see
   the reason for. */

export interface OpenReadyCheck {
  /* The table's id. Not a match id: no match row exists yet, and if the check
     fails none ever will. Only ever shown back to the client so it can tell
     one prompt from the next. */
  id: string;
  format: MatchFormat;
  seats: number; // seats at the table, bots included
  humans: string[]; // who has to accept
  /* Deal the table. Called once, after the last human has accepted, and only
     then: everything a table needs that could go stale in twenty seconds (a
     bot that got taken by another table, say) belongs inside here rather than
     in what the caller gathered before the check opened. */
  start: () => Promise<void>;
  /* The check died. `failed` is whoever caused it, `kept` is everybody who
     did accept and is owed their place back, and `why` says which way it
     went. Cooldowns are the caller's to apply, because an arena's answer to
     a no-show is not a queue's: see `chargeNoShow`. */
  onCancel: (failed: string[], kept: string[], why: ReadyFailure) => void;
  /* How long a check runs. The arena runs a shorter one, because a player
     there is already sitting on the page waiting to be paired. */
  windowMs?: number;
}

interface Pending extends OpenReadyCheck {
  accepted: Set<string>;
  deadline: number;
  timer: ReturnType<typeof setTimeout>;
  settled: boolean;
}

const pending = new Map<string, Pending>(); // by table id
const byUser = new Map<string, Pending>(); // a player is only ever in one
/* No-shows per player, as the times they happened. Pruned to the window when
   it is read, so this map holds an hour of history and no more. */
const noShows = new Map<string, number[]>();
const cooldowns = new Map<string, number>(); // user id to epoch ms

/* ------------------------------------------------------------- cooldowns */

/* When this player may queue again, or null when they may now. Pruning here
   rather than on a timer: the answer is only ever wanted at the moment
   somebody queues, and a sweep would be a second clock keeping the same
   thing true. */
export function cooldownUntil(userId: string, now = Date.now()): number | null {
  const until = cooldowns.get(userId);
  if (until === undefined) return null;
  if (until <= now) {
    cooldowns.delete(userId);
    return null;
  }
  return until;
}

/* Charge a no-show. The nth inside the hour costs twice what the (n-1)th did,
   which is `readyCooldownMs` in the protocol, so the client counts down the
   same number this sets. Returns when they are free again. */
export function chargeNoShow(userId: string, now = Date.now()): number {
  const recent = (noShows.get(userId) ?? []).filter((at) => now - at < READY_COOLDOWN_WINDOW_MS);
  recent.push(now);
  noShows.set(userId, recent);
  const until = now + readyCooldownMs(recent.length);
  cooldowns.set(userId, until);
  return until;
}

/* ---------------------------------------------------------- the check */

export function checkFor(userId: string): OpenReadyCheck | null {
  return byUser.get(userId) ?? null;
}

export function pendingCount(): number {
  return pending.size;
}

/* Open a check. Everybody in it is told at once, and the table is dealt only
   when the last of them has said yes. A check with nobody human in it is a
   contradiction, so it is refused rather than started and instantly settled:
   the only tables with no people at them are the ladder's, and nothing asks
   those whether they are ready. */
export function openReadyCheck(check: OpenReadyCheck, now = Date.now()): boolean {
  if (check.humans.length === 0) return false;
  // A player already in a check cannot be in a second one. The caller took
  // them out of its queue, so refusing here would strand them; this is the
  // guard that says the caller got it wrong, and it is worth being loud.
  for (const uid of check.humans) {
    if (byUser.has(uid)) return false;
  }

  const windowMs = check.windowMs ?? READY_CHECK_MS;
  const entry: Pending = {
    ...check,
    accepted: new Set(),
    deadline: now + windowMs,
    settled: false,
    timer: setTimeout(() => expire(check.id), windowMs),
  };
  pending.set(check.id, entry);
  for (const uid of check.humans) byUser.set(uid, entry);
  broadcast(entry, 'pending');
  return true;
}

/* One answer. A decline kills the check immediately; an accept either moves
   the counter or, if it was the last one outstanding, deals the table. */
export function respondReady(userId: string, accept: boolean): void {
  const entry = byUser.get(userId);
  if (!entry || entry.settled) return;
  if (!accept) {
    settle(entry, [userId], 'declined');
    return;
  }
  if (entry.accepted.has(userId)) return;
  entry.accepted.add(userId);
  broadcast(entry, 'accepted');
  if (entry.accepted.size < entry.humans.length) return;

  entry.settled = true;
  clearTimeout(entry.timer);
  release(entry);
  // The table is dealt after the check has let go of everybody, so a failure
  // inside `start` cannot leave people held by a check that is already over.
  // They are told by `q found`, which is what every other path to a table
  // sends, so a client needs no fourth ready state to handle this one.
  void entry.start().catch((err) => {
    console.error(`ready check ${entry.id} could not start its table:`, err);
    for (const uid of entry.humans) {
      hub.send(uid, { t: 'err', c: 'no_match', msg: 'That table could not be started. Search again.' });
    }
  });
}

/* Somebody left before answering. Used by an explicit cancel, which is a
   decline by another name: a player who presses cancel while five people are
   waiting on them has not shown up either. */
export function declineReady(userId: string): boolean {
  const entry = byUser.get(userId);
  if (!entry || entry.settled) return false;
  settle(entry, [userId], 'declined');
  return true;
}

function expire(id: string): void {
  const entry = pending.get(id);
  if (!entry || entry.settled) return;
  const missing = entry.humans.filter((uid) => !entry.accepted.has(uid));
  settle(entry, missing, 'timeout');
}

function settle(entry: Pending, failed: string[], why: ReadyFailure): void {
  entry.settled = true;
  clearTimeout(entry.timer);
  const kept = entry.humans.filter((uid) => !failed.includes(uid));
  release(entry);
  // Told before the caller does anything about it, so the cooldown the caller
  // may charge is already in place when the client asks what it can do next.
  entry.onCancel(failed, kept, why);
  for (const uid of entry.humans) {
    const isFailed = failed.includes(uid);
    const until = isFailed ? cooldownUntil(uid) : null;
    hub.send(uid, {
      t: 'ready',
      s: 'cancelled',
      ...view(entry),
      why,
      requeued: !isFailed,
      ...(until ? { cooldownUntil: until } : {}),
    });
  }
}

function release(entry: Pending): void {
  pending.delete(entry.id);
  for (const uid of entry.humans) {
    if (byUser.get(uid) === entry) byUser.delete(uid);
  }
}

function view(entry: Pending) {
  return {
    id: entry.id,
    mode: entry.format.mode,
    speed: speedOf(entry.format),
    rated: entry.format.rated,
    seats: entry.seats,
    humans: entry.humans.length,
    accepted: entry.accepted.size,
    deadline: entry.deadline,
  };
}

function broadcast(entry: Pending, s: 'pending' | 'accepted'): void {
  for (const uid of entry.humans) hub.send(uid, { t: 'ready', s, ...view(entry) });
}

/* Test seam. Cooldowns and pending checks are process state, and a suite that
   left either behind would fail the next file rather than its own. */
export function resetReadyChecks(): void {
  for (const entry of pending.values()) clearTimeout(entry.timer);
  pending.clear();
  byUser.clear();
  noShows.clear();
  cooldowns.clear();
}
