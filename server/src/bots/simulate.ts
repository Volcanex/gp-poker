/* Playing bots against each other through the engine, with no database, no
   room and no socket. The level ordering test and the benchmark script both
   run on this, so what they measure is the same thing measured the same way.

   Nothing here decides anything: it builds the `TableView` a client would see
   for whoever is to act, asks a brain for an action and applies it. A brain is
   a function of a view, which is what lets the same harness hold the
   synchronous levels and the solver, which is neither synchronous nor
   stateless. */

import { apply, createHand, legal, type HandState } from '@opentable/engine';
import { runInline, SolverBot, type SolveRunner } from '@opentable/solver';
import type { ActionKind, BotLevel, Card, MatchFormat, SeatView, TableView } from '@opentable/protocol';
import { decide, type BotDecision, type Rng } from './strategy.js';
import { budgetFor, thinkingTier } from './solver.js';

export function mulberry32(seed: number): Rng {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFrom(rng: Rng): string {
  let s = '';
  for (let i = 0; i < 32; i++) s += Math.floor(rng() * 256).toString(16).padStart(2, '0');
  return s;
}

export interface ViewOptions {
  format: MatchFormat;
  matchId?: string;
  handNumber?: number;
}

// The same shape server/src/match/handRunner.ts builds, minus everything the
// strategy does not read: a two-seat hand needs no engine-to-table seat map.
export function viewOf(state: HandState, seat: number, options: ViewOptions): TableView {
  const pot = state.seats.reduce((sum, s) => sum + s.committed, 0);
  const seats: SeatView[] = state.seats.map((s, i) => {
    let last: { a: ActionKind; v?: number } | null = null;
    for (let j = state.actions.length - 1; j >= 0; j--) {
      if (state.actions[j].s === i) {
        last = { a: state.actions[j].a, v: state.actions[j].v };
        break;
      }
    }
    return {
      i,
      uid: `s${i}`,
      name: `s${i}`,
      rating: 1500,
      stack: s.stack,
      bet: s.bet,
      cards: s.cards === null ? null : i === seat ? ([...s.cards] as Card[]) : (['?', '?'] as Card[]),
      folded: s.folded,
      allin: s.allin,
      button: i === state.config.button,
      acting: state.toAct === i,
      connected: true,
      bot: true,
      out: false,
      place: null,
      last,
    };
  });
  const l = legal(state, seat);
  return {
    m: options.matchId ?? 'sim',
    h: options.handNumber ?? 1,
    n: state.seq,
    street: state.street,
    board: state.board,
    pot,
    pots: [],
    seats,
    you: seat,
    legal: { actions: l.actions, call: l.call, min: l.min, max: l.max },
    clock: null,
    seedHash: '',
    seed: null,
    format: options.format,
    blinds: { sb: state.config.sb, bb: state.config.bb },
    handsPlayed: 0,
    last: null,
    result: null,
  };
}

export interface Brain {
  (view: TableView, rng: Rng): BotDecision | Promise<BotDecision>;
  // Told when a hand is over, which is the only place a fold can be seen: a
  // fold ends the hand and the folding seat is never asked again.
  finish?(result: Pick<TableView, 'm' | 'h' | 'result'>): void;
}

/* Iterations until the process has burned `budgetMs` of processor, rather than
   until that much wall clock has passed.

   This box is shared. A benchmark that measures wall clock while three other
   things are running measures the other three things: the solver gets a
   quarter of the budget it was given and plays a quarter as well, and the
   result looks like a worse bot rather than a busier machine. Live play is the
   opposite way round, because there the decision clock is wall clock and being
   busy really does mean thinking less, which is why this is the benchmark's
   runner and not the server's. */
export function cpuRunner(budgetMs: number): SolveRunner {
  return async (prepared) => {
    const start = process.cpuUsage();
    for (;;) {
      const used = process.cpuUsage(start);
      const spent = (used.user + used.system) / 1000;
      if (spent >= budgetMs) return;
      prepared.cfr.run({ budgetMs: Math.min(25, budgetMs - spent), checkEvery: 1 });
    }
  };
}

/* A brain for one seat. Levels 1 to 5 are the pure function; level 6 gets its
   own SolverBot, because its whole point is the state it keeps across a hand.
   The solver runs inline here rather than in slices: a benchmark has no event
   loop to be polite to. */
export function brainForLevel(level: BotLevel, budgetMs?: number, byCpuTime = false): Brain {
  const tier = thinkingTier(level);
  if (!tier) return (view, rng) => decide(view, rng, level);
  const bot = new SolverBot({ tier, fallback: (view, rng) => decide(view, rng, level) });
  const runner = byCpuTime && budgetMs !== undefined ? cpuRunner(budgetMs) : runInline;
  const brain: Brain = async (view, rng) => bot.decide(view, rng, runner, budgetMs ?? budgetFor(view.format.clockMs, tier));
  brain.finish = (result) => bot.observeResult(result);
  return brain;
}

export interface HandSetup {
  stack: number;
  sb: number;
  bb: number;
  button: number;
  seed: string;
}

export interface HandOutcome {
  chips: [number, number];
  // Wall clock milliseconds each decision took, by seat.
  latency: [number[], number[]];
}

/* One deal, played to the end by the two brains given. Chips are measured
   against the stack each seat sat down with. */
export async function playHand(
  brains: [Brain, Brain],
  setup: HandSetup,
  options: ViewOptions,
  rng: Rng
): Promise<HandOutcome> {
  let state = createHand({
    seats: [
      { id: 's0', stack: setup.stack },
      { id: 's1', stack: setup.stack },
    ],
    button: setup.button,
    sb: setup.sb,
    bb: setup.bb,
    seed: setup.seed,
  });

  const latency: [number[], number[]] = [[], []];
  // The engine ends a hand in a bounded number of actions; the guard is here
  // so a strategy bug is a failed assertion rather than a hung suite.
  for (let step = 0; state.street !== 'done' && step < 400; step++) {
    const seat = state.toAct;
    if (seat === null) break;
    const started = Date.now();
    const decision = await brains[seat](viewOf(state, seat, options), rng);
    latency[seat].push(Date.now() - started);
    state = apply(state, seat, decision.v !== undefined ? { a: decision.a, v: decision.v } : { a: decision.a });
  }
  if (state.street !== 'done') throw new Error('a hand did not finish');

  const ended = {
    m: options.matchId ?? 'sim',
    h: options.handNumber ?? 1,
    result: state.result ? { awards: state.result.awards, shown: state.result.shown } : null,
  };
  for (const brain of brains) brain.finish?.(ended);

  return {
    chips: [state.seats[0].stack - setup.stack, state.seats[1].stack - setup.stack],
    latency,
  };
}
