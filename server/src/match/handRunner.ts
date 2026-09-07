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
import { blindsAt } from '@opentable/protocol';
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
import type { HandRunner, MatchOutcome, RoomClock } from './types.js';

// How long a completed hand's result stays on screen before the next hand
// deals (or the match ends), long enough for the reveal to actually settle.
// Capped at the decision clock so a test running a 300ms clock doesn't spend
// four seconds per hand staring at a finished board.
export const HAND_HOLD_MS = 4_000;

export interface HandRunnerDeps {
  matchId: string;
  match: MatchRow;
  onChange: () => void;
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
  private seatsInfo: MatchSeat[];
  private playerIds: string[];
  private stacks: number[];
  private places: (number | null)[];

  private liveSeats: number[] = [];
  private button = 0; // table seat
  private handStartStacks: number[];
  private handsPlayed = 0;
  private handNumber = 0;
  private handDbId = '';
  private currentSeedHash = '';
  private handStartedAt = 0;
  private state!: HandState;
  private lastEvent: LastEvent | null = null;
  private matchOutcome: MatchOutcome | null = null;

  constructor(deps: HandRunnerDeps) {
    this.matchId = deps.matchId;
    this.match = deps.match;
    this.onChange = deps.onChange;
    this.seatsInfo = [...deps.match.seats].sort((a, b) => a.seat - b.seat);
    this.playerIds = this.seatsInfo.map((s) => s.userId);
    this.stacks = this.seatsInfo.map(() => deps.match.format.stack);
    this.places = this.seatsInfo.map(() => null);
    this.handStartStacks = [...this.stacks];
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
    const { sb, bb } = blindsAt(this.match.format, number);
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
    if (this.state.street === 'done') void this.completeHand();
  }

  onAction(userId: string, msg: Extract<ClientMsg, { t: 'act' }>): boolean {
    const tableSeat = this.seatOf(userId);
    if (tableSeat === null) return false; // unreachable: the room only forwards players here
    const seat = this.engineSeat(tableSeat);

    if (seat === null || seat !== this.state.toAct) {
      hub.send(userId, { t: 'err', c: 'not_your_turn', msg: 'it is not your turn' });
      return false;
    }
    if (msg.h !== this.handNumber || msg.n !== this.state.seq) {
      hub.send(userId, { t: 'err', c: 'stale', msg: 'that hand or action has already moved on' });
      return false;
    }

    let next: HandState;
    try {
      next = apply(this.state, seat, msg.v !== undefined ? { a: msg.a, v: msg.v } : { a: msg.a });
    } catch (err) {
      const message = err instanceof IllegalAction ? err.message : 'illegal action';
      hub.send(userId, { t: 'err', c: 'illegal', msg: message });
      return false;
    }

    this.stampLastAction(next);
    this.lastEvent = this.classifyTransition(this.state, next, false);
    this.state = next;
    if (next.street === 'done') void this.completeHand();
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
    if (next.street === 'done') void this.completeHand();
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

  viewFor(userId: string | null, clock: RoomClock | null, connected: boolean[]): TableView | null {
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
        rating: info.rating,
        connected: connected[i] ?? true,
        bot: info.bot ?? false,
        out: e === null,
        place: this.places[i],
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
      handsPlayed: this.handsPlayed,
      last: this.lastEvent,
      result,
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

    const finished = this.headsUp ? await this.settleHeadsUp() : await this.settleMultiway();
    if (finished) {
      this.onChange();
      return;
    }

    setTimeout(
      () => {
        void this.startHand(this.handNumber + 1).then(() => this.onChange());
      },
      Math.min(HAND_HOLD_MS, this.match.format.clockMs)
    );
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
    const ratings = computeMatchRatings(inputs, places, this.match.rated);

    this.matchOutcome = {
      winner,
      reason,
      stacks: this.currentStacks(),
      places,
      ratings,
    };
  }
}
