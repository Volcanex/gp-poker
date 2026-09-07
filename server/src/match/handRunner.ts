import {
  apply,
  createHand,
  IllegalAction,
  legal,
  newSeed,
  seedHash,
  visibleCards,
  type HandConfig,
  type HandState,
} from '@opentable/engine';
import { extractDecisions, handStats, summarise } from '@opentable/preflop';
import type {
  ActionKind,
  ClientMsg,
  HandResult,
  LastEvent,
  LegalActions,
  SeatView,
  TableView,
} from '@opentable/protocol';
import { getUserById, insertHand, updateHand, updateMatchHandsPlayed, type HandStudy, type MatchRow, type MatchSeat } from '../db.js';
import { hub } from '../ws/hub.js';
import { computeMatchRatings } from './rating.js';
import type { HandRunner, MatchOutcome, RoomClock } from './types.js';

// How long a completed hand's result stays on screen before the next hand
// deals (or the match ends), long enough for the reveal to actually settle.
export const HAND_HOLD_MS = 4_000;

export interface HandRunnerDeps {
  matchId: string;
  match: MatchRow;
  onChange: () => void;
}

export class EngineHandRunner implements HandRunner {
  private matchId: string;
  private match: MatchRow;
  private onChange: () => void;
  private seatsInfo: MatchSeat[];
  private playerIds: [string, string];
  private stacks: [number, number];

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
    this.playerIds = [this.seatsInfo[0].userId, this.seatsInfo[1].userId];
    this.stacks = [deps.match.format.stack, deps.match.format.stack];
  }

  private seatOf(userId: string): number | null {
    const i = this.playerIds.indexOf(userId);
    return i === -1 ? null : i;
  }

  async startHand(number: number): Promise<void> {
    const seed = newSeed();
    const hash = seedHash(seed);
    const button = (number - 1) % 2;
    const config: HandConfig = {
      seats: [
        { id: this.playerIds[0], stack: this.stacks[0] },
        { id: this.playerIds[1], stack: this.stacks[1] },
      ],
      button,
      sb: this.match.format.sb,
      bb: this.match.format.bb,
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
      button,
      stacksStart: [...this.stacks],
    });

    this.handDbId = handId;
    this.handNumber = number;
    this.currentSeedHash = hash;
    this.handStartedAt = Date.now();
    this.state = createHand(config);
    this.lastEvent = { k: number === 1 ? 'deal' : 'newhand' };

    // Both players could already be all-in from the blinds alone (extreme
    // short stacks): the engine resolves straight to showdown inside
    // createHand, with nothing for anyone to act on.
    if (this.state.street === 'done') void this.completeHand();
  }

  onAction(userId: string, msg: Extract<ClientMsg, { t: 'act' }>): boolean {
    const seat = this.seatOf(userId);
    if (seat === null) return false; // unreachable: the room only forwards players here

    if (seat !== this.state.toAct) {
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

  onTimeout(seat: number): void {
    if (this.state.street === 'done' || this.state.toAct !== seat) return;
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
    const base = { seat: lastAction.s, a: lastAction.a, v: lastAction.v };

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
    return this.state.toAct;
  }

  isDone(): boolean {
    return this.matchOutcome !== null;
  }

  matchResult(): MatchOutcome | null {
    return this.matchOutcome;
  }

  currentStacks(): Record<string, number> {
    return { [this.playerIds[0]]: this.stacks[0], [this.playerIds[1]]: this.stacks[1] };
  }

  viewFor(userId: string | null, clock: RoomClock | null, connected: boolean[]): TableView | null {
    const state = this.state;
    const viewerSeat = userId !== null ? this.seatOf(userId) : null;
    const cardsPerSeat = visibleCards(state, viewerSeat);

    const seats: SeatView[] = state.seats.map((s, i) => {
      let lastForSeat: { a: ActionKind; v?: number } | null = null;
      for (let j = state.actions.length - 1; j >= 0; j--) {
        if (state.actions[j].s === i) {
          lastForSeat = { a: state.actions[j].a, v: state.actions[j].v };
          break;
        }
      }
      return {
        i,
        uid: this.playerIds[i],
        name: this.seatsInfo[i].name,
        rating: this.seatsInfo[i].rating,
        stack: s.stack,
        bet: s.bet,
        cards: cardsPerSeat[i],
        folded: s.folded,
        allin: s.allin,
        button: i === state.config.button,
        acting: state.toAct === i,
        connected: connected[i] ?? true,
        last: lastForSeat,
      };
    });

    let legalActions: LegalActions | null = null;
    if (viewerSeat !== null && state.toAct === viewerSeat) {
      const l = legal(state, viewerSeat);
      legalActions = { actions: l.actions, call: l.call, min: l.min, max: l.max };
    }

    const pot = state.seats.reduce((sum, s) => sum + s.committed, 0);
    const pots = state.result ? state.result.pots.map((p) => ({ amount: p.amount, seats: p.eligible })) : [];
    const result: HandResult | null = state.result ? { awards: state.result.awards, shown: state.result.shown } : null;

    return {
      m: this.matchId,
      h: this.handNumber,
      n: state.seq,
      street: state.street,
      board: state.board,
      pot,
      pots,
      seats,
      you: viewerSeat,
      legal: legalActions,
      clock,
      seedHash: this.currentSeedHash,
      seed: state.street === 'done' ? state.config.seed : null,
      format: this.match.format,
      handsPlayed: this.handsPlayed,
      last: this.lastEvent,
      result,
    };
  }

  private async completeHand(): Promise<void> {
    const state = this.state;
    const extractConfig = {
      seats: state.config.seats.map((s) => ({ stack: s.stack })),
      button: state.config.button,
      bb: state.config.bb,
    };
    const holes: Record<number, [string, string]> = {};
    state.seats.forEach((s, i) => {
      if (s.cards) holes[i] = s.cards;
    });

    const decisions = extractDecisions(extractConfig, state.actions, holes);
    const stats = handStats(extractConfig, state.actions, holes);
    const study: Record<number, HandStudy> = {};
    for (let i = 0; i < state.seats.length; i++) {
      const seatDecisions = decisions.filter((d) => d.seat === i);
      study[i] = { decisions: seatDecisions, summary: summarise(seatDecisions) };
    }

    await updateHand(this.handDbId, {
      seed: state.config.seed,
      actions: state.actions,
      board: state.board,
      holes,
      result: state.result!,
      stats,
      study,
      completedAt: new Date(),
    });

    this.stacks = [state.seats[0].stack, state.seats[1].stack];
    this.handsPlayed += 1;
    await updateMatchHandsPlayed(this.matchId, this.handsPlayed);

    const bust = this.stacks.some((s) => s === 0);
    const exhausted = this.handsPlayed >= this.match.format.hands;
    if (bust || exhausted) {
      await this.finishNaturally(bust ? 'bust' : 'hands');
      this.onChange();
      return;
    }

    setTimeout(() => {
      void this.startHand(this.handNumber + 1).then(() => this.onChange());
    }, HAND_HOLD_MS);
  }

  private async finishNaturally(reason: 'bust' | 'hands'): Promise<void> {
    const [stackA, stackB] = this.stacks;
    const winnerSeat = stackA === stackB ? null : stackA > stackB ? 0 : 1;
    const scoreForA: 0 | 0.5 | 1 = winnerSeat === null ? 0.5 : winnerSeat === 0 ? 1 : 0;

    const [userA, userB] = await Promise.all([getUserById(this.playerIds[0]), getUserById(this.playerIds[1])]);
    const ratings =
      userA && userB
        ? computeMatchRatings(
            { userId: userA.id, rating: userA.rating, rd: userA.rd, volatility: userA.volatility, ratingAt: userA.ratingAt },
            { userId: userB.id, rating: userB.rating, rd: userB.rd, volatility: userB.volatility, ratingAt: userB.ratingAt },
            scoreForA
          )
        : {
            [this.playerIds[0]]: { before: 0, after: 0, rdBefore: 0, rdAfter: 0, volatility: 0.06 },
            [this.playerIds[1]]: { before: 0, after: 0, rdBefore: 0, rdAfter: 0, volatility: 0.06 },
          };

    this.matchOutcome = {
      winner: winnerSeat === null ? null : this.playerIds[winnerSeat],
      reason,
      stacks: this.currentStacks(),
      ratings,
    };
  }
}
