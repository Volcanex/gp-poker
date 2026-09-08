import type { ChatFrom, ClientMsg, MatchResult, ServerMsg } from '@opentable/protocol';
import { CHAT_HISTORY } from '@opentable/protocol';
import { hub } from '../ws/hub.js';
import { ChatLimiter, chatRejectionText, cleanChatText } from '../chat.js';
import {
  finishMatch as persistFinishMatch,
  getRatingsForUsers,
  getUserById,
  insertChatMessage,
  type MatchRow,
} from '../db.js';
import { trackSpectator, unregisterRoom, untrackSpectator } from './rooms.js';
import { emitMatchFinished } from './finished.js';
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
type ChatLine = Extract<ServerMsg, { t: 'chat' }>;

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
  // Subscribers who have no seat. A subset of `subscribers`, kept apart only
  // so the room can say how many people are watching and so a disconnect
  // knows which subscriptions to drop: a player's stays through their grace
  // window, a spectator's does not.
  private spectators = new Set<string>();
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
  // Chat, two channels and one allowance. The players' channel goes to
  // everybody; the rail's goes only to the rail, so a table cannot be coached
  // from it. They are capped separately rather than as one list of a hundred:
  // a busy rail would otherwise evict the conversation a reconnecting player
  // came back for.
  private chatLimiter = new ChatLimiter();
  private playerChat: ChatLine[] = [];
  private railChat: ChatLine[] = [];

  private hand: HandRunner | null = null;

  // The format is the only source of truth for whether this match is rated.
  // `matches.rated` is a copy of it, re-asserted on finish; nothing reads the
  // column to make a decision.
  private get rated(): boolean {
    return this.match.format.rated;
  }

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
      onFail: (err) => this.abandon(err),
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

  // Anyone may join. A player joins their own table; anybody else becomes a
  // spectator and is sent exactly the view an opponent gets, with no seat and
  // every hole card hidden until showdown. A finished room lingers a minute,
  // and a join inside that window still gets the final view and the result,
  // so a link followed moments too late reads rather than erroring.
  join(userId: string): void {
    this.subscribers.add(userId);
    if (!this.playerIds.includes(userId) && !this.spectators.has(userId)) {
      this.spectators.add(userId);
      trackSpectator(userId, this);
    }
    this.sendViewTo(userId);
    this.replayChatTo(userId);
    if (this.match.status === 'finished' && this.lastResult) {
      hub.send(userId, { t: 'end', m: this.id, r: this.lastResult });
    }
  }

  leave(userId: string): void {
    this.subscribers.delete(userId);
    if (this.spectators.delete(userId)) untrackSpectator(userId, this);
  }

  // How many people are watching without a seat. Reported on /api/live and
  // deliberately never sent to the table: a count that moves while somebody
  // is deciding is a distraction, not information.
  get spectatorCount(): number {
    return this.spectators.size;
  }

  get spectatorIds(): string[] {
    return [...this.spectators];
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

  /* ------------------------------------------------------------------ chat */

  /* What somebody arriving is owed. A player is owed the table's conversation;
     a spectator is owed that and the rail's, merged back into the order it was
     said in, because two lists side by side read as two conversations. */
  private replayChatTo(userId: string): void {
    const lines = this.spectators.has(userId)
      ? [...this.playerChat, ...this.railChat].sort((a, b) => a.at - b.at)
      : this.playerChat;
    for (const line of lines) hub.send(userId, line);
  }

  /* One message. The allowance is spent here, synchronously, before anything
     is awaited: two messages arriving in the same tick would otherwise both
     pass a check made after a database round trip, and the gap that stops a
     flood would not exist. The name lookup follows, and only an accepted
     message is ever sent on or stored. */
  handleChat(userId: string, msg: Extract<ClientMsg, { t: 'chat' }>): void {
    if (!this.subscribers.has(userId)) {
      hub.send(userId, { t: 'err', c: 'no_match', msg: 'join the table before chatting' });
      return;
    }
    const clean = cleanChatText(msg.text);
    if (!clean.ok) {
      hub.send(userId, { t: 'err', c: 'chat', msg: chatRejectionText(clean.reason!) });
      return;
    }
    const now = Date.now();
    const limited = this.chatLimiter.check(userId, now);
    if (limited) {
      hub.send(userId, {
        t: 'err',
        c: 'chat',
        msg: chatRejectionText(limited, this.chatLimiter.waitFor(userId, now)),
      });
      return;
    }
    this.chatLimiter.record(userId, now);
    void this.deliverChat(userId, clean.text, now).catch((err) => {
      console.error(`match ${this.id} chat failed:`, err);
    });
  }

  private async deliverChat(userId: string, text: string, at: number): Promise<void> {
    const user = await getUserById(userId);
    if (!user) return;
    // A bot has nothing to say. Nothing in `src/bots/` sends one, and if
    // something ever did, a table should not repeat it as though it did.
    if (user.bot) return;

    const seatIndex = this.playerIds.indexOf(userId);
    const seat = seatIndex === -1 ? null : seatIndex;
    const from: ChatFrom = { id: user.id, name: user.name, bot: false, seat };
    const line: ChatLine = { t: 'chat', m: this.id, from, text, at };

    if (seat === null) {
      this.railChat = [...this.railChat, line].slice(-CHAT_HISTORY);
      for (const uid of this.spectators) hub.send(uid, line);
    } else {
      this.playerChat = [...this.playerChat, line].slice(-CHAT_HISTORY);
      for (const uid of this.subscribers) hub.send(uid, line);
    }

    await insertChatMessage({ matchId: this.id, userId, seat, text, at: new Date(at) });
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
        this.forfeit(opponent).catch((err) => this.abandon(err));
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
    if (outcome) this.finishMatch(outcome).catch((err) => this.abandon(err));
  }

  // Last resort for a room that cannot continue: the match row is gone, or
  // the database refused a write from a timer nobody is awaiting. Stop every
  // timer and drop the room from the registry rather than let the rejection
  // reach the process. There is no wire message for this, the same as the
  // boot-time abort: a client that comes back gets `no_match`.
  private abandon(err: unknown): void {
    this.clearClockTimer();
    for (const t of this.graceTimers.values()) clearTimeout(t);
    this.graceTimers.clear();
    this.hand = null;
    console.error(`match ${this.id} abandoned:`, err);
    unregisterRoom(this.id);
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

    const standings = await getRatingsForUsers(this.playerIds, this.match.format.mode);
    const inputs = this.playerIds.map((uid) => {
      const r = standings.get(uid)!;
      return { userId: uid, rating: r.rating, rd: r.rd, volatility: r.volatility, ratingAt: r.ratingAt };
    });
    const ratings = computeMatchRatings(inputs, places, this.rated);
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
        rating: this.rated ? { rating: r.after, rd: r.rdAfter, volatility: r.volatility } : null,
      };
    });

    const rawRatings = toMatchResultRatings(outcome);
    await persistFinishMatch(this.id, {
      status: 'finished',
      mode: this.match.format.mode,
      rated: this.rated,
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
      rated: this.rated,
      ratings: roundRatings(rawRatings),
    };
    this.lastResult = result;
    for (const uid of this.subscribers) hub.send(uid, { t: 'end', m: this.id, r: result });
    // After the result has been persisted and sent, so anything scoring off it
    // (the arena board) is reading a match that is finished everywhere else.
    emitMatchFinished({
      id: this.id,
      format: this.match.format,
      playerIds: this.playerIds,
      winner: outcome.winner,
      reason: outcome.reason,
      places: outcome.places,
    });
    setTimeout(() => unregisterRoom(this.id), ROOM_LINGER_MS);
  }
}
