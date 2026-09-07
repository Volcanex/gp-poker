import type { ClientMsg, MatchResult, TableView } from '@opentable/protocol';
import { hub } from '../ws/hub.js';
import { finishMatch as persistFinishMatch, type MatchRow } from '../db.js';
import { unregisterRoom } from './rooms.js';

export interface RoomClock {
  seat: number;
  deadline: number; // epoch ms
  paused: boolean;
}

// Everything finishMatch needs to persist and to report, richer than the
// wire-level MatchResult because it carries the Glicko-2 volatility that
// never goes out over the wire. Phase two (once @opentable/rating is wired
// into the hand runner) is the only thing that constructs one of these.
export interface MatchOutcome {
  winner: string | null;
  reason: MatchResult['reason'];
  stacks: Record<string, number>;
  ratings: Record<string, { before: number; after: number; rdBefore: number; rdAfter: number; volatility: number }>;
}

function toWireResult(outcome: MatchOutcome): MatchResult {
  const ratings: MatchResult['ratings'] = {};
  for (const [uid, r] of Object.entries(outcome.ratings)) {
    ratings[uid] = { before: r.before, after: r.after, rdBefore: r.rdBefore, rdAfter: r.rdAfter };
  }
  return { winner: outcome.winner, reason: outcome.reason, stacks: outcome.stacks, rated: true, ratings };
}

/* The seam phase two fills in: everything about actually running NLHE hands
   (dealing, legality, applying actions, settling pots, scoring preflop
   accuracy). MatchRoom below owns orchestration only — subscribers, the wall
   clock, disconnect grace, persistence and rating writeback — and never
   touches a HandState directly. It talks to the hand only through this
   interface, and gets the clock's own state handed *to* viewFor rather than
   asking the hand to know about disconnects at all. */
export interface HandRunner {
  startHand(number: number): Promise<void>;
  onAction(userId: string, msg: Extract<ClientMsg, { t: 'act' }>): void;
  // Called by the room's clock on expiry. Implementation: apply 'x' if legal
  // for this seat, else 'f', logging the action with `to: true`.
  onTimeout(seat: number): void;
  toActSeat(): number | null; // null when no decision is pending (between hands, at showdown)
  isDone(): boolean; // true once the whole match is decided (bust or hands played out)
  matchResult(): MatchOutcome | null; // non-null once isDone()
  viewFor(userId: string | null, clock: RoomClock | null): TableView | null;
}

export class MatchRoom {
  readonly id: string;
  readonly playerIds: string[]; // seat order

  private match: MatchRow;
  private subscribers = new Set<string>();
  private disconnected = new Set<string>();
  private graceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private timeoutStreak = new Map<string, number>();
  private clockTimer: ReturnType<typeof setTimeout> | null = null;
  private clock: RoomClock | null = null;

  // TODO(phase two): construct the real HandRunner here (engine + preflop
  // scoring) and call `void this.hand.startHand(1)` once both seats are set.
  private hand: HandRunner | null = null;

  constructor(match: MatchRow) {
    this.id = match.id;
    this.match = match;
    this.playerIds = [...match.seats].sort((a, b) => a.seat - b.seat).map((s) => s.userId);
    for (const uid of this.playerIds) this.timeoutStreak.set(uid, 0);
  }

  join(userId: string): void {
    this.subscribers.add(userId);
    this.sendViewTo(userId);
  }

  leave(userId: string): void {
    this.subscribers.delete(userId);
  }

  private sendViewTo(userId: string): void {
    if (!this.hand) return;
    const view = this.hand.viewFor(userId, this.clock);
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
    this.hand.onAction(userId, msg);
    this.timeoutStreak.set(userId, 0);
    this.broadcast();
    this.rearmClock();
    this.settleIfDone();
  }

  // The decision clock. A fresh clockMs window starts whenever toActSeat()
  // changes; it is armed with a real setTimeout to the deadline, and the
  // deadline is also mirrored into `clock` so viewFor can report it. While
  // the acting player is disconnected the timer itself is not running
  // (`paused: true` instead) — handleGraceExpiry stands in for it.
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
    const paused = userId !== undefined && this.disconnected.has(userId);
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
    if (streak >= 3) {
      const opponent = this.playerIds.find((id) => id !== userId) ?? null;
      void this.forfeit(opponent);
      return;
    }
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
  // time across the pause — simpler, and indistinguishable to the player).
  handleDisconnect(userId: string): void {
    if (!this.playerIds.includes(userId) || this.match.status !== 'playing') return;
    this.disconnected.add(userId);
    if (this.clock && this.playerIds[this.clock.seat] === userId) {
      this.clearClockTimer();
      this.clock = { ...this.clock, paused: true };
      this.broadcast();
    }
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
      this.broadcast();
    }
  }

  private handleGraceExpiry(userId: string): void {
    this.graceTimers.delete(userId);
    if (!this.disconnected.has(userId)) return; // reconnected already, nothing to do
    const seat = this.playerIds.indexOf(userId);
    if (seat === -1) return;
    this.handleClockExpiry(seat);
  }

  private async forfeit(winnerId: string | null): Promise<void> {
    const outcome = this.hand?.matchResult() ?? this.buildForfeitOutcome(winnerId);
    await this.finishMatch(outcome);
  }

  // TODO(phase two): once @opentable/rating is wired into the hand runner,
  // this fallback goes away — a forfeit becomes just another matchResult().
  // Volatility is left at each player's last known value since a forfeit
  // outside a completed hand has no new Glicko-2 observation to fold in.
  private buildForfeitOutcome(winnerId: string | null): MatchOutcome {
    const ratings: MatchOutcome['ratings'] = {};
    for (const uid of this.playerIds) {
      ratings[uid] = { before: 0, after: 0, rdBefore: 0, rdAfter: 0, volatility: 0.06 };
    }
    return { winner: winnerId, reason: 'forfeit', stacks: {}, ratings };
  }

  async finishMatch(outcome: MatchOutcome): Promise<void> {
    this.clearClockTimer();
    for (const t of this.graceTimers.values()) clearTimeout(t);
    this.graceTimers.clear();

    const players = this.match.rated
      ? this.playerIds.map((uid) => {
          const r = outcome.ratings[uid];
          const result: 'win' | 'loss' | 'draw' =
            outcome.winner === null ? 'draw' : outcome.winner === uid ? 'win' : 'loss';
          return { userId: uid, rating: r.after, rd: r.rdAfter, volatility: r.volatility, outcome: result };
        })
      : [];

    await persistFinishMatch(this.id, {
      status: 'finished',
      winner: outcome.winner,
      reason: outcome.reason,
      finalStacks: outcome.stacks,
      ratings: toWireResult(outcome).ratings,
      players,
    });

    this.match = { ...this.match, status: 'finished', winner: outcome.winner, reason: outcome.reason };
    const result = toWireResult(outcome);
    for (const uid of this.subscribers) hub.send(uid, { t: 'end', m: this.id, r: result });
    unregisterRoom(this.id);
  }
}
