import type { ClientMsg, MatchResult } from '@opentable/protocol';
import { hub } from '../ws/hub.js';
import { finishMatch as persistFinishMatch, getUserById, type MatchRow } from '../db.js';
import { unregisterRoom } from './rooms.js';
import { EngineHandRunner } from './handRunner.js';
import { computeMatchRatings } from './rating.js';
import { roundRatings } from '../userView.js';
import type { HandRunner, MatchOutcome, RoomClock } from './types.js';

export type { HandRunner, MatchOutcome, RoomClock } from './types.js';

// How long a finished match's room stays addressable after it ends, so a
// `join` that arrives moments after `end` (or a client that was mid-reconnect)
// still gets the final state instead of `no_match`.
const ROOM_LINGER_MS = 60_000;

// Consecutive timeouts before a player stops being treated as present.
const TIMEOUT_STREAK_LIMIT = 3;

// Full Glicko-2 precision, no volatility (that never goes on the wire).
// `matches.ratings` is persisted with this, full precision, the `end`
// message sends `roundRatings()` of it instead.
function toMatchResultRatings(outcome: MatchOutcome): MatchResult['ratings'] {
  const ratings: MatchResult['ratings'] = {};
  for (const [uid, r] of Object.entries(outcome.ratings)) {
    ratings[uid] = { before: r.before, after: r.after, rdBefore: r.rdBefore, rdAfter: r.rdAfter };
  }
  return ratings;
}

export class MatchRoom {
  readonly id: string;
  readonly playerIds: string[]; // seat order

  private match: MatchRow;
  private subscribers = new Set<string>();
  private disconnected = new Set<string>();
  private graceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private timeoutStreak = new Map<string, number>();
  // Multiway only: a player who timed out three times running is sat out,
  // auto check-folding every decision while still posting blinds, until they
  // bust or act again. Heads-up forfeits instead, as it always has.
  private satOut = new Set<string>();
  private clockTimer: ReturnType<typeof setTimeout> | null = null;
  private clock: RoomClock | null = null;
  private lastResult: MatchResult | null = null;

  private hand: HandRunner | null = null;

  constructor(match: MatchRow) {
    this.id = match.id;
    this.match = match;
    this.playerIds = [...match.seats].sort((a, b) => a.seat - b.seat).map((s) => s.userId);
    for (const uid of this.playerIds) this.timeoutStreak.set(uid, 0);
  }

  // Builds the hand runner and deals hand 1. Callers (matchmaking) should
  // await this before telling clients the match was `found`, so a join right
  // after that message always has a hand to view.
  async start(): Promise<void> {
    this.hand = new EngineHandRunner({
      matchId: this.id,
      match: this.match,
      onChange: () => {
        this.broadcast();
        this.rearmClock();
        this.settleIfDone();
      },
    });
    await this.hand.startHand(1);
    this.broadcast();
    this.rearmClock();
  }

  // Whether the match is still live. Matchmaking asks this before putting a
  // bot into a new table, since a finished room lingers for a minute.
  get active(): boolean {
    return this.match.status === 'playing';
  }

  join(userId: string): void {
    this.subscribers.add(userId);
    this.sendViewTo(userId);
    if (this.match.status === 'finished' && this.lastResult) {
      hub.send(userId, { t: 'end', m: this.id, r: this.lastResult });
    }
  }

  leave(userId: string): void {
    this.subscribers.delete(userId);
  }

  private connectedArray(): boolean[] {
    return this.playerIds.map((id) => !this.disconnected.has(id));
  }

  private sendViewTo(userId: string): void {
    if (!this.hand) return;
    const view = this.hand.viewFor(userId, this.clock, this.connectedArray());
    if (view) hub.send(userId, { t: 'state', s: view });
  }

  broadcast(): void {
    if (!this.hand) return;
    for (const uid of this.subscribers) this.sendViewTo(uid);
  }

  handleAct(userId: string, msg: Extract<ClientMsg, { t: 'act' }>): void {
    if (!this.hand || this.match.status !== 'playing') {
      hub.send(userId, { t: 'err', c: 'no_match', msg: 'match has no active hand' });
      return;
    }
    if (!this.playerIds.includes(userId)) {
      hub.send(userId, { t: 'err', c: 'not_your_turn', msg: 'spectators cannot act' });
      return;
    }
    // Any attempt to act un-sits a sat-out player, including one the room
    // rejects: the auto check-fold fires the instant it becomes their turn,
    // so a real player coming back always arrives too late to act cleanly.
    if (this.satOut.delete(userId)) this.timeoutStreak.set(userId, 0);
    const applied = this.hand.onAction(userId, msg);
    if (!applied) return; // the hand runner already sent the specific err
    this.timeoutStreak.set(userId, 0);
    this.broadcast();
    this.rearmClock();
    this.settleIfDone();
  }

  // The decision clock. A fresh clockMs window starts whenever toActSeat()
  // changes; it is armed with a real setTimeout to the deadline, and the
  // deadline is also mirrored into `clock` so viewFor can report it. While
  // the acting player is disconnected the timer itself is not running
  // (`paused: true` instead), handleGraceExpiry stands in for it.
  private rearmClock(): void {
    this.clearClockTimer();
    if (!this.hand) {
      this.clock = null;
      return;
    }
    const seat = this.hand.toActSeat();
    if (seat === null) {
      this.clock = null;
      return;
    }
    const userId = this.playerIds[seat];
    if (userId !== undefined && this.satOut.has(userId)) {
      // Sat out: fold (or check) immediately rather than burning the clock.
      // Deferred by a timer so a whole street of sat-out seats unwinds as
      // separate turns instead of recursing through rearmClock.
      this.clock = { seat, deadline: Date.now(), paused: false };
      this.clockTimer = setTimeout(() => this.autoActSatOut(seat), 0);
      return;
    }
    // Paused only while the grace window is still open. Once grace has
    // expired the clock runs against a disconnected player, otherwise a
    // player who never comes back would freeze the match on their turn.
    const paused = userId !== undefined && this.disconnected.has(userId) && this.graceTimers.has(userId);
    const deadline = Date.now() + this.match.format.clockMs;
    this.clock = { seat, deadline, paused };
    if (!paused) this.armTimer(deadline, seat);
  }

  private armTimer(deadline: number, seat: number): void {
    const delay = Math.max(0, deadline - Date.now());
    this.clockTimer = setTimeout(() => this.handleClockExpiry(seat), delay);
  }

  private clearClockTimer(): void {
    if (this.clockTimer) {
      clearTimeout(this.clockTimer);
      this.clockTimer = null;
    }
  }

  private handleClockExpiry(seat: number): void {
    const userId = this.playerIds[seat];
    if (!userId || !this.hand) return;
    this.hand.onTimeout(seat);
    const streak = (this.timeoutStreak.get(userId) ?? 0) + 1;
    this.timeoutStreak.set(userId, streak);
    this.broadcast();
    if (streak >= TIMEOUT_STREAK_LIMIT) {
      if (this.playerIds.length === 2) {
        const opponent = this.playerIds.find((id) => id !== userId) ?? null;
        void this.forfeit(opponent);
        return;
      }
      // Multiway: forfeiting one seat would hand the rest of the table a
      // free elimination, so the player is sat out and blinded off instead.
      this.satOut.add(userId);
    }
    this.rearmClock();
    this.settleIfDone();
  }

  private autoActSatOut(seat: number): void {
    this.clockTimer = null;
    if (!this.hand || this.match.status !== 'playing') return;
    this.hand.onTimeout(seat);
    this.broadcast();
    this.rearmClock();
    this.settleIfDone();
  }

  private settleIfDone(): void {
    if (!this.hand?.isDone()) return;
    const outcome = this.hand.matchResult();
    if (outcome) void this.finishMatch(outcome);
  }

  // Disconnect/reconnect and the grace window. A player has graceMs from the
  // moment their last socket drops before a pending decision is timed out on
  // their behalf; reconnecting inside that window clears the grace timer and
  // grants a fresh full decision clock (we do not track sub-second remaining
  // time across the pause, simpler, and indistinguishable to the player).
  handleDisconnect(userId: string): void {
    if (!this.playerIds.includes(userId) || this.match.status !== 'playing') return;
    this.disconnected.add(userId);
    if (this.clock && this.playerIds[this.clock.seat] === userId) {
      this.clearClockTimer();
      this.clock = { ...this.clock, paused: true };
    }
    this.broadcast(); // let the opponent see connected:false / paused right away
    const timer = setTimeout(() => this.handleGraceExpiry(userId), this.match.format.graceMs);
    this.graceTimers.set(userId, timer);
  }

  handleReconnect(userId: string): void {
    const timer = this.graceTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.graceTimers.delete(userId);
    }
    this.disconnected.delete(userId);
    if (this.clock && this.playerIds[this.clock.seat] === userId && this.clock.paused) {
      const deadline = Date.now() + this.match.format.clockMs;
      this.clock = { seat: this.clock.seat, deadline, paused: false };
      this.armTimer(deadline, this.clock.seat);
    }
    this.broadcast();
  }

  private handleGraceExpiry(userId: string): void {
    this.graceTimers.delete(userId);
    if (!this.disconnected.has(userId)) return; // reconnected already, nothing to do
    const seat = this.playerIds.indexOf(userId);
    if (seat === -1) return;
    this.handleClockExpiry(seat);
  }

  private async forfeit(winnerId: string | null): Promise<void> {
    const outcome = this.hand?.matchResult() ?? (await this.buildForfeitOutcome(winnerId));
    await this.finishMatch(outcome);
  }

  // Heads-up only: three consecutive timeouts hands the match to the
  // opponent before the hand runner ever reaches isDone(), so the outcome
  // (including the rating change) is built here instead of asked for.
  private async buildForfeitOutcome(winnerId: string | null): Promise<MatchOutcome> {
    const stacks = this.hand?.currentStacks() ?? {};
    const places: Record<string, number> = {};
    for (const uid of this.playerIds) places[uid] = winnerId === null ? 1 : uid === winnerId ? 1 : 2;

    const users = await Promise.all(this.playerIds.map((uid) => getUserById(uid)));
    if (users.some((u) => u === null)) {
      // Unreachable in practice, every seat must exist for the match to
      // exist, but degrade to a no-op rating change rather than throwing.
      const ratings: MatchOutcome['ratings'] = {};
      for (const uid of this.playerIds) ratings[uid] = { before: 0, after: 0, rdBefore: 0, rdAfter: 0, volatility: 0.06 };
      return { winner: winnerId, reason: 'forfeit', stacks, places, ratings };
    }
    const inputs = users.map((u) => ({
      userId: u!.id,
      rating: u!.rating,
      rd: u!.rd,
      volatility: u!.volatility,
      ratingAt: u!.ratingAt,
    }));
    const ratings = computeMatchRatings(inputs, places, this.match.rated);
    return { winner: winnerId, reason: 'forfeit', stacks, places, ratings };
  }

  async finishMatch(outcome: MatchOutcome): Promise<void> {
    this.clearClockTimer();
    for (const t of this.graceTimers.values()) clearTimeout(t);
    this.graceTimers.clear();

    // Counters move for every finished match; the Glicko-2 state and a
    // rating_history row only for a rated one. Multiway has no draw: first
    // place is a win, every other place a loss.
    const multiway = this.playerIds.length > 2;
    const players = this.playerIds.map((uid) => {
      const r = outcome.ratings[uid];
      const place = outcome.places[uid] ?? this.playerIds.length;
      const result: 'win' | 'loss' | 'draw' = multiway
        ? place === 1
          ? 'win'
          : 'loss'
        : outcome.winner === null
          ? 'draw'
          : outcome.winner === uid
            ? 'win'
            : 'loss';
      return {
        userId: uid,
        place,
        outcome: result,
        rating: this.match.rated ? { rating: r.after, rd: r.rdAfter, volatility: r.volatility } : null,
      };
    });

    const rawRatings = toMatchResultRatings(outcome);
    await persistFinishMatch(this.id, {
      status: 'finished',
      winner: outcome.winner,
      reason: outcome.reason,
      finalStacks: outcome.stacks,
      places: outcome.places,
      ratings: rawRatings,
      players,
    });

    this.match = { ...this.match, status: 'finished', winner: outcome.winner, reason: outcome.reason };
    const result: MatchResult = {
      winner: outcome.winner,
      reason: outcome.reason,
      stacks: outcome.stacks,
      places: outcome.places,
      rated: this.match.rated,
      ratings: roundRatings(rawRatings),
    };
    this.lastResult = result;
    for (const uid of this.subscribers) hub.send(uid, { t: 'end', m: this.id, r: result });
    setTimeout(() => unregisterRoom(this.id), ROOM_LINGER_MS);
  }
}
