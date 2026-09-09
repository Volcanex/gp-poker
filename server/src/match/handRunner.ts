import {
  apply,
  createHand,
  IllegalAction,
  legal,
  newSeed,
  seedHash,
  visibleCards,
  type HandConfig,
  type HandOutcome,
  type HandState,
} from '@opentable/engine';
import { extractDecisions, handStats, summarise } from '@opentable/preflop';
import { HAND_HOLD_MS, blindsAt, holdFor, levelAt, practiceHoldTimeoutFor } from '@opentable/protocol';
import type {
  ActionKind,
  Card,
  ClientMsg,
  HandResult,
  LastEvent,
  LegalActions,
  LoggedAction,
  SeatView,
  TableView,
} from '@opentable/protocol';
import { getRatingsForUsers, insertHand, updateHand, updateMatchHandsPlayed, type HandStudy, type MatchRow, type MatchSeat } from '../db.js';
import { hub } from '../ws/hub.js';
import { computeMatchRatings } from './rating.js';
import type { HandRunner, MatchOutcome, RoomClock, SeatPresence } from './types.js';

// The hold a completed hand's result stays on screen for. It lives in the
// protocol because the client counts the same number down in the dock, and two
// copies of it drift. `holdFor` is the one that reads a format's own `holdMs`,
// which is how a ladder hand runs without a four-second pause nobody watches.
export { HAND_HOLD_MS };

export interface HandRunnerDeps {
  matchId: string;
  match: MatchRow;
  onChange: () => void;
  // Dealing and hand completion are detached async work: they run from a
  // timer or after an action has already returned, so nothing is left to
  // await their rejection. Without somewhere to send it a failed insert
  // becomes an unhandled rejection, which Node ends the process over,
  // killing every other live match with it.
  onFail: (err: unknown) => void;
}

/* Runs the hands of one match over @opentable/engine.

   Two seat numberings meet here. TABLE seats are 0..N-1, fixed for the whole
   match: that is what the wire, the database and MatchRoom all speak. ENGINE
   seats are the indexes of the HandConfig this hand was dealt with, which
   holds only the seats that still have chips. `liveSeats[engineSeat] =
   tableSeat` is the map, rebuilt at the start of every hand and persisted on
   the hand row (`live_seats`) so a replay can reconstruct the same config.
   Everything crossing the boundary - actions in, views out, the stored
   action log, holes and result - is translated, so nothing outside this file
   ever sees an engine seat. */
export class EngineHandRunner implements HandRunner {
  private matchId: string;
  private match: MatchRow;
  private onChange: () => void;
  private onFail: (err: unknown) => void;
  private seatsInfo: MatchSeat[];
  private playerIds: string[];
  private stacks: number[];
  private places: (number | null)[];

  private liveSeats: number[] = [];
  private button = 0; // table seat
  /* When this match started, which is the other basis a blind schedule can
     climb on. A short format has no hand basis at all: its levels advance on
     the clock so that the table is over inside twenty minutes however slowly
     it is being played, and a long one keeps a much coarser time basis behind
     its hand one so that two people running the clock down on every decision
     still cannot outlive two hours. `levelAt` takes whichever is further
     along; see the schedules in @opentable/protocol for the arithmetic.

     Read from the match row rather than stamped at construction, so a room
     rebuilt over an existing match keeps the clock it was actually created
     on rather than restarting the ladder. */
  private startedAtMs: number;
  private currentLevel = 0;
  private handStartStacks: number[];
  private handsPlayed = 0;
  private handNumber = 0;
  private handDbId = '';
  private currentSeedHash = '';
  private handStartedAt = 0;
  private state!: HandState;
  private lastEvent: LastEvent | null = null;
  private matchOutcome: MatchOutcome | null = null;

  // Practice hold. `practice` and `humanSeat` are fixed for the life of the
  // match; `pendingNextHand` is non-null only while a hand's result is being
  // held for the human's `next`, and is the hand number they must echo.
  private practice: boolean;
  private humanSeat: number | null;
  private pendingNextHand: number | null = null;
  private nextResolve: (() => void) | null = null;
  private nextTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: HandRunnerDeps) {
    this.matchId = deps.matchId;
    this.match = deps.match;
    this.onChange = deps.onChange;
    this.onFail = deps.onFail;
    this.seatsInfo = [...deps.match.seats].sort((a, b) => a.seat - b.seat);
    this.playerIds = this.seatsInfo.map((s) => s.userId);
    this.stacks = this.seatsInfo.map(() => deps.match.format.stack);
    this.places = this.seatsInfo.map(() => null);
    this.handStartStacks = [...this.stacks];
    this.startedAtMs = deps.match.createdAt?.getTime() ?? Date.now();
    this.practice = deps.match.format.practice === true;
    const human = this.seatsInfo.findIndex((s) => !s.bot);
    this.humanSeat = this.practice && human !== -1 ? human : null;
  }

  private get headsUp(): boolean {
    return this.match.format.mode === 'heads-up';
  }

  private seatOf(userId: string): number | null {
    const i = this.playerIds.indexOf(userId);
    return i === -1 ? null : i;
  }

  private engineSeat(tableSeat: number): number | null {
    const e = this.liveSeats.indexOf(tableSeat);
    return e === -1 ? null : e;
  }

  private tableSeat(engineSeat: number): number {
    return this.liveSeats[engineSeat];
  }

  private stillIn(): number[] {
    const seats: number[] = [];
    for (let i = 0; i < this.playerIds.length; i++) {
      if (this.places[i] === null && this.stacks[i] > 0) seats.push(i);
    }
    return seats;
  }

  // Hand 1 puts the button on the lowest live table seat (seat 0 heads-up,
  // matching the original (number - 1) % 2 rotation); every later hand moves
  // it to the next live seat clockwise, skipping anyone who has busted.
  private nextButton(live: number[], number: number): number {
    if (number === 1) return live[0];
    const n = this.playerIds.length;
    for (let step = 1; step <= n; step++) {
      const seat = (this.button + step) % n;
      if (live.includes(seat)) return seat;
    }
    return live[0];
  }

  async startHand(number: number): Promise<void> {
    const live = this.stillIn();
    const seed = newSeed();
    const hash = seedHash(seed);
    const elapsed = Date.now() - this.startedAtMs;
    const level = levelAt(this.match.format, number, elapsed);
    const { sb, bb } = blindsAt(this.match.format, number, elapsed);
    this.currentLevel = level;
    this.button = this.nextButton(live, number);
    this.liveSeats = live;
    const config: HandConfig = {
      seats: live.map((t) => ({ id: this.playerIds[t], stack: this.stacks[t] })),
      button: live.indexOf(this.button),
      sb,
      bb,
      seed,
    };
    const handId = `${this.matchId}-${number}`;

    // The commitment (seed hash, button, starting stacks) must exist before
    // any card is dealt, so a client can verify fairness even if the server
    // crashes mid-hand.
    await insertHand({
      id: handId,
      matchId: this.matchId,
      number,
      seedHash: hash,
      button: this.button,
      stacksStart: [...this.stacks],
      liveSeats: live,
      // Recorded rather than left to be recomputed: a short schedule's level
      // is a function of how long the match had been running, which nothing
      // reading this row afterwards can know.
      sb,
      bb,
    });

    this.handDbId = handId;
    this.handNumber = number;
    this.currentSeedHash = hash;
    this.handStartedAt = Date.now();
    this.handStartStacks = [...this.stacks];
    this.state = createHand(config);
    this.lastEvent = { k: number === 1 ? 'deal' : 'newhand' };

    // Everyone left could already be all-in from the blinds alone (extreme
    // short stacks): the engine resolves straight to showdown inside
    // createHand, with nothing for anyone to act on.
    if (this.state.street === 'done') this.complete();
  }

  onAction(userId: string, msg: Extract<ClientMsg, { t: 'act' }>): boolean {
    const tableSeat = this.seatOf(userId);
    if (tableSeat === null) return false; // unreachable: the room only forwards players here
    const seat = this.engineSeat(tableSeat);

    if (seat === null || seat !== this.state.toAct) {
      hub.send(userId, { t: 'err', c: 'not_your_turn', msg: 'It is not your turn' });
      return false;
    }
    if (msg.h !== this.handNumber || msg.n !== this.state.seq) {
      hub.send(userId, { t: 'err', c: 'stale', msg: 'That hand or action has already moved on' });
      return false;
    }

    let next: HandState;
    try {
      next = apply(this.state, seat, msg.v !== undefined ? { a: msg.a, v: msg.v } : { a: msg.a });
    } catch (err) {
      const message = err instanceof IllegalAction ? err.message : 'That action is not legal here';
      hub.send(userId, { t: 'err', c: 'illegal', msg: message });
      return false;
    }

    this.stampLastAction(next);
    this.lastEvent = this.classifyTransition(this.state, next, false);
    this.state = next;
    if (next.street === 'done') this.complete();
    return true;
  }

  onTimeout(tableSeat: number): void {
    const seat = this.engineSeat(tableSeat);
    if (seat === null || this.state.street === 'done' || this.state.toAct !== seat) return;
    const leg = legal(this.state, seat);
    const action = leg.actions.includes('x') ? { a: 'x' as ActionKind } : { a: 'f' as ActionKind };
    const next = apply(this.state, seat, action);
    this.stampLastAction(next, true);
    this.lastEvent = this.classifyTransition(this.state, next, true);
    this.state = next;
    if (next.street === 'done') this.complete();
  }

  // The one place hand completion is kicked off from, so its failure has
  // exactly one route out.
  private complete(): void {
    this.completeHand().catch(this.onFail);
  }

  // The human asking to deal the next hand rather than wait out the hold.
  // Anything that is not exactly the thing being waited for is ignored: no
  // hold in progress, a hand number that has already moved on, a spectator
  // (seatOf returns null), or a seat that is not the human's.
  next(userId: string, msg: Extract<ClientMsg, { t: 'next' }>): void {
    if (this.pendingNextHand === null || msg.h !== this.pendingNextHand) return;
    if (this.seatOf(userId) !== this.humanSeat) return;
    this.resolveHold();
  }

  // Whether this hand's hold should wait for the human to say `next` rather
  // than run out on its own clock. Only true on a practice table where the
  // human is still seated: once they have busted out of a multiway table
  // there is nobody left to press the button, and the remaining bot-only
  // hands play out at the ordinary pace instead of waiting on someone who
  // cannot answer.
  private waitingForHuman(): boolean {
    return this.practice && this.humanSeat !== null && this.places[this.humanSeat] === null;
  }

  // The pause after a hand: the ordinary fixed sleep everywhere else, or, on
  // a practice table with the human still in it, a wait for their `next`
  // with a safety timeout so a player who walks away does not hang a table
  // that still has bots seated at it. Broadcasting here (`onChange`) is what
  // puts `hold: 'you'` on the human's view for the wait; nothing else in this
  // hand has changed, so there is nothing else to send.
  private holdAfterHand(): Promise<void> {
    if (!this.waitingForHuman()) {
      return new Promise((resolve) => setTimeout(resolve, holdFor(this.match.format)));
    }
    return new Promise((resolve) => {
      this.pendingNextHand = this.handNumber;
      this.nextResolve = resolve;
      this.nextTimer = setTimeout(() => this.resolveHold(), practiceHoldTimeoutFor(this.match.format));
      this.onChange();
    });
  }

  private resolveHold(): void {
    if (this.nextTimer) {
      clearTimeout(this.nextTimer);
      this.nextTimer = null;
    }
    const resolve = this.nextResolve;
    this.pendingNextHand = null;
    this.nextResolve = null;
    if (resolve) resolve();
  }

  private stampLastAction(state: HandState, timedOut = false): void {
    const idx = state.actions.length - 1;
    const t = Date.now() - this.handStartedAt;
    state.actions[idx] = { ...state.actions[idx], t, ...(timedOut ? { to: true } : {}) };
  }

  private classifyTransition(prev: HandState, next: HandState, forcedTimeout: boolean): LastEvent {
    const lastAction = next.actions[next.actions.length - 1];
    const base = { seat: this.tableSeat(lastAction.s), a: lastAction.a, v: lastAction.v };

    if (next.street === 'done' && prev.street !== 'done') {
      const shown = next.result?.shown ?? {};
      return Object.keys(shown).length > 0 ? { k: 'showdown', ...base } : { k: 'award', ...base };
    }
    if (next.board.length > prev.board.length) {
      return { k: 'street', cards: next.board.slice(prev.board.length) };
    }
    if (forcedTimeout) return { k: 'timeout', ...base };
    return { k: 'act', ...base };
  }

  toActSeat(): number | null {
    return this.state.toAct === null ? null : this.tableSeat(this.state.toAct);
  }

  isDone(): boolean {
    return this.matchOutcome !== null;
  }

  matchResult(): MatchOutcome | null {
    return this.matchOutcome;
  }

  currentStacks(): Record<string, number> {
    const out: Record<string, number> = {};
    this.playerIds.forEach((id, i) => {
      out[id] = this.stacks[i];
    });
    return out;
  }

  currentPlaces(): Record<string, number> {
    const out: Record<string, number> = {};
    this.playerIds.forEach((id, i) => {
      const place = this.places[i];
      if (place !== null) out[id] = place;
    });
    return out;
  }

  viewFor(userId: string | null, clock: RoomClock | null, presence: SeatPresence[]): TableView | null {
    const state = this.state;
    const viewerTableSeat = userId !== null ? this.seatOf(userId) : null;
    const viewerEngineSeat = viewerTableSeat === null ? null : this.engineSeat(viewerTableSeat);
    const cardsPerSeat = visibleCards(state, viewerEngineSeat);

    const seats: SeatView[] = this.playerIds.map((uid, i) => {
      const info = this.seatsInfo[i];
      const e = this.engineSeat(i);
      const base = {
        i,
        uid,
        name: info.name,
        ...(info.country ? { country: info.country } : {}),
        rating: info.rating,
        connected: presence[i]?.connected ?? true,
        bot: info.bot ?? false,
        avatarV: info.avatarV ?? 0,
        out: e === null,
        place: this.places[i],
        // Absent rather than false: almost every seat in almost every hand
        // is not sitting out, and the wire says so by not mentioning it.
        ...(presence[i]?.sittingOut ? { sittingOut: true as const } : {}),
      };
      if (e === null) {
        return {
          ...base,
          stack: this.stacks[i],
          bet: 0,
          cards: null,
          folded: false,
          allin: false,
          button: false,
          acting: false,
          last: null,
        };
      }
      const s = state.seats[e];
      let lastForSeat: { a: ActionKind; v?: number } | null = null;
      for (let j = state.actions.length - 1; j >= 0; j--) {
        if (state.actions[j].s === e) {
          lastForSeat = { a: state.actions[j].a, v: state.actions[j].v };
          break;
        }
      }
      return {
        ...base,
        stack: s.stack,
        bet: s.bet,
        cards: cardsPerSeat[e],
        folded: s.folded,
        allin: s.allin,
        button: i === this.button,
        acting: state.toAct === e,
        last: lastForSeat,
      };
    });

    let legalActions: LegalActions | null = null;
    if (viewerEngineSeat !== null && state.toAct === viewerEngineSeat) {
      const l = legal(state, viewerEngineSeat);
      legalActions = { actions: l.actions, call: l.call, min: l.min, max: l.max };
    }

    const pot = state.seats.reduce((sum, s) => sum + s.committed, 0);
    const pots = state.result
      ? state.result.pots.map((p) => ({ amount: p.amount, seats: p.eligible.map((e) => this.tableSeat(e)) }))
      : [];
    const tableResult = state.result ? this.toTableSeats(state.result) : null;
    const result: HandResult | null = tableResult ? { awards: tableResult.awards, shown: tableResult.shown } : null;

    return {
      m: this.matchId,
      h: this.handNumber,
      n: state.seq,
      street: state.street,
      board: state.board,
      pot,
      pots,
      seats,
      you: viewerTableSeat,
      legal: legalActions,
      clock,
      seedHash: this.currentSeedHash,
      seed: state.street === 'done' ? state.config.seed : null,
      format: this.match.format,
      blinds: { sb: state.config.sb, bb: state.config.bb },
      level: this.currentLevel,
      handsPlayed: this.handsPlayed,
      last: this.lastEvent,
      result,
      ...(this.pendingNextHand !== null && viewerTableSeat === this.humanSeat ? { hold: 'you' as const } : {}),
    };
  }

  private toTableSeats(result: HandOutcome): HandOutcome {
    const shown: Record<number, [Card, Card]> = {};
    for (const [seat, cards] of Object.entries(result.shown)) shown[this.tableSeat(Number(seat))] = cards;
    return {
      pots: result.pots.map((p) => ({ amount: p.amount, eligible: p.eligible.map((e) => this.tableSeat(e)) })),
      awards: result.awards.map((a) => ({ ...a, seat: this.tableSeat(a.seat) })),
      shown,
    };
  }

  private tableActions(): LoggedAction[] {
    return this.state.actions.map((a) => ({ ...a, s: this.tableSeat(a.s) }));
  }

  private async completeHand(): Promise<void> {
    const state = this.state;
    const actions = this.tableActions();
    const holes: Record<number, [Card, Card]> = {};
    state.seats.forEach((s, e) => {
      if (s.cards) holes[this.tableSeat(e)] = s.cards;
    });

    // Preflop study and stats are heads-up only: the charts and the spot
    // walker in @opentable/preflop model two players, so a six-max hand
    // stores null for both rather than a wrong number.
    let stats;
    let study: Record<number, HandStudy> | undefined;
    if (this.headsUp) {
      const extractConfig = {
        seats: this.handStartStacks.map((stack) => ({ stack })),
        button: this.button,
        bb: state.config.bb,
      };
      const decisions = extractDecisions(extractConfig, actions, holes);
      stats = handStats(extractConfig, actions, holes);
      study = {};
      for (let i = 0; i < this.playerIds.length; i++) {
        const seatDecisions = decisions.filter((d) => d.seat === i);
        study[i] = { decisions: seatDecisions, summary: summarise(seatDecisions) };
      }
    }

    await updateHand(this.handDbId, {
      seed: state.config.seed,
      actions,
      board: state.board,
      holes,
      result: this.toTableSeats(state.result!),
      ...(stats ? { stats } : {}),
      ...(study ? { study } : {}),
      completedAt: new Date(),
    });

    state.seats.forEach((s, e) => {
      this.stacks[this.tableSeat(e)] = s.stack;
    });
    this.handsPlayed += 1;
    await updateMatchHandsPlayed(this.matchId, this.handsPlayed);

    if (this.matchWouldFinish()) {
      // The last hand is held on screen like any other before the result:
      // on a practice table with the human still in it, that means waiting
      // for their `next` rather than a fixed sleep. `places` has not been
      // touched yet, so `waitingForHuman` still reads the human as live even
      // on the hand that is about to bust them.
      await this.holdAfterHand();
    }
    const finished = this.headsUp ? await this.settleHeadsUp() : await this.settleMultiway();
    if (finished) {
      this.onChange();
      return;
    }

    if (this.waitingForHuman()) {
      // `places` is now settled for this hand, so a human who just busted
      // out of a multiway table no longer holds up the bot-only hands after
      // them.
      await this.holdAfterHand();
      await this.startHand(this.handNumber + 1);
      this.onChange();
      return;
    }

    setTimeout(
      () => {
        this.startHand(this.handNumber + 1).then(() => this.onChange(), this.onFail);
      },
      holdFor(this.match.format)
    );
  }

  private matchWouldFinish(): boolean {
    const alive = this.stacks.filter((x) => x > 0).length;
    if (this.headsUp) {
      const exhausted = this.match.format.hands !== null && this.handsPlayed >= this.match.format.hands;
      return alive < 2 || exhausted;
    }
    return alive < 2;
  }

  private async settleHeadsUp(): Promise<boolean> {
    const bust = this.stacks.some((s) => s === 0);
    const exhausted = this.match.format.hands !== null && this.handsPlayed >= this.match.format.hands;
    if (!bust && !exhausted) return false;

    const [stackA, stackB] = this.stacks;
    const winnerSeat = stackA === stackB ? null : stackA > stackB ? 0 : 1;
    this.places = winnerSeat === null ? [1, 1] : winnerSeat === 0 ? [1, 2] : [2, 1];
    await this.finishNaturally(bust ? 'bust' : 'hands', winnerSeat === null ? null : this.playerIds[winnerSeat]);
    return true;
  }

  // Reverse elimination order. Everyone who busted this hand shares the block
  // of places just below whoever is left, ordered by the stack they started
  // the hand with (the bigger stack outlasted the smaller one, so it places
  // higher). The last player standing takes place 1 and the match is over.
  private async settleMultiway(): Promise<boolean> {
    const stillIn = this.playerIds.map((_, i) => i).filter((i) => this.places[i] === null);
    const busted = stillIn.filter((i) => this.stacks[i] === 0);
    busted.sort((a, b) => this.handStartStacks[b] - this.handStartStacks[a]);
    busted.forEach((seat, k) => {
      this.places[seat] = stillIn.length - busted.length + 1 + k;
    });

    const survivors = this.playerIds.map((_, i) => i).filter((i) => this.places[i] === null);
    if (survivors.length > 1) return false;
    if (survivors.length === 1) this.places[survivors[0]] = 1;
    const winnerSeat = this.places.findIndex((p) => p === 1);
    await this.finishNaturally('bust', winnerSeat === -1 ? null : this.playerIds[winnerSeat]);
    return true;
  }

  private async finishNaturally(reason: 'bust' | 'hands', winner: string | null): Promise<void> {
    const places = this.currentPlaces();
    // Rating state for this match's mode only. A player with no row there
    // yet reads as a fresh 1500/350.
    const standings = await getRatingsForUsers(this.playerIds, this.match.format.mode);
    const inputs = this.playerIds.map((id) => {
      const r = standings.get(id)!;
      return { userId: id, rating: r.rating, rd: r.rd, volatility: r.volatility, ratingAt: r.ratingAt };
    });
    const ratings = computeMatchRatings(inputs, places, this.match.format.rated);

    this.matchOutcome = {
      winner,
      reason,
      stacks: this.currentStacks(),
      places,
      ratings,
    };
  }
}
