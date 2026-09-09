/* Level 6: the decision that has to think.

   Levels 1 to 5 are one pure function and answer in microseconds. Level 6
   tracks both ranges through the hand and runs CFR+ on the street in front of
   it, which is a second of processor time, so it needs three things the others
   do not: state that lives across a hand, a clock, and somewhere to run that
   is not "all of it, right now".

   **It runs on the main thread, in slices.** The obvious answer is a worker
   thread, and it was the plan. The server ships as a single esbuild bundle
   (`server/build.mjs`) because the workspace packages are TypeScript source
   with no build of their own, so a worker entry point would need a second
   bundle in production and a TypeScript loader inside a worker in dev, which
   Node does not carry across the thread boundary. That is two code paths for
   the thing that decides how the bots play, and the one that only runs in
   production is the one nobody exercises.

   The alternative costs one property of the solver: nothing it does may block
   for long. It already holds. A CFR+ iteration on a real subgame is a couple
   of milliseconds, and the one part that was not incremental (ranking every
   runout of a depth limited leaf) was made incremental for this. So the runner
   below runs iterations for about eight milliseconds, yields to the event
   loop, and goes again until the budget is spent. A websocket sitting behind a
   solving bot waits about ten milliseconds, not a second.

   Two solves at a time. A third falls back to level 5 rather than making all
   three slow: a bot that answers in time with a worse decision beats a bot
   that answers late. */

import { SolverBot, type PreparedSubgame } from '@opentable/solver';
import type { BotLevel, TableView } from '@opentable/protocol';
import type { BotDecision, Rng } from './strategy.js';

export const SOLVER_LEVEL: BotLevel = 6;

// Never think for longer than this, whatever the clock allows. Past about a
// second the curve is flat (see packages/solver/CLAUDE.md) and the rest is
// processor nobody gets anything for.
const MAX_BUDGET_MS = 1500;
const CLOCK_FRACTION = 4;

// How long a slice runs before it hands the event loop back.
const SLICE_MS = 8;

const MAX_CONCURRENT = 2;

let running = 0;

const bots = new Map<string, SolverBot>();

export function budgetFor(clockMs: number): number {
  return Math.max(1, Math.min(MAX_BUDGET_MS, Math.floor(clockMs / CLOCK_FRACTION)));
}

export function solverLoad(): number {
  return running;
}

const yieldToLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

async function slicedRunner(prepared: PreparedSubgame, budgetMs: number): Promise<void> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const left = deadline - Date.now();
    if (left <= 0) return;
    prepared.cfr.run({ budgetMs: Math.min(SLICE_MS, left), checkEvery: 1 });
    await yieldToLoop();
  }
}

/* One action, or null when the spot is not one the solver plays (more than two
   players in the hand, a preflop line the charts do not name, the queue being
   full). Null means the caller should ask level 5, which is what player.ts
   does. */
export async function decideSolver(userId: string, view: TableView, rng: Rng): Promise<BotDecision | null> {
  if (running >= MAX_CONCURRENT) return null;
  let bot = bots.get(userId);
  if (!bot) {
    bot = new SolverBot();
    bots.set(userId, bot);
  }
  running += 1;
  try {
    return await bot.decide(view, rng, slicedRunner, budgetFor(view.format.clockMs));
  } finally {
    running -= 1;
  }
}

// The roster is fixed and small, so this is only ever called by a test that
// wants a bot with no memory of the hand before.
export function forgetSolverState(): void {
  bots.clear();
}
