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

import { ensureLegal, type BotDecision, type Rng } from './strategy.js';

export const SOLVER_LEVEL: BotLevel = 6;

// Never think for longer than this, whatever the clock allows. Past about a
// second the curve is flat (see packages/solver/CLAUDE.md) and the rest is
// processor nobody gets anything for.
const MAX_BUDGET_MS = 1500;
const CLOCK_FRACTION = 4;

/* The ladder plays bots against each other in the gaps when nobody is here,
   one match after another, forever. Two level 6 accounts meeting on it at the
   full budget would keep a core busy around the clock on a four core box that
   also runs everything else Gabriel has. Nobody is watching a ladder match, so
   it gets a fraction of the thinking time and a slightly worse bot. */
const LADDER_BUDGET_MS = 250;

// How long a slice runs before it hands the event loop back.
const SLICE_MS = 8;

const MAX_CONCURRENT = 2;

let running = 0;

const bots = new Map<string, SolverBot>();

export function budgetFor(clockMs: number, ladder = false): number {
  const ceiling = ladder ? LADDER_BUDGET_MS : MAX_BUDGET_MS;
  return Math.max(1, Math.min(ceiling, Math.floor(clockMs / CLOCK_FRACTION)));
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
    const decision = await bot.decide(view, rng, slicedRunner, budgetFor(view.format.clockMs, view.format.ladder === true));
    // Same gate every other level leaves through. The solver clamps against
    // the legal window itself, so this is a guarantee rather than a fix, and
    // it is the sort of guarantee that should not depend on a package outside
    // this directory continuing to be careful.
    return decision === null ? null : ensureLegal(decision, view.legal!);
  } catch (err) {
    // A bot that throws must not take the table with it. Level 5 answers
    // instead, and the reason is on the record.
    console.error(`level 6 decision failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  } finally {
    running -= 1;
  }
}

/* Told when a hand ends, because a fold can only be seen after the fact: the
   hand is over and the bot is never asked again. See `SolverBot`. */
export function observeSolverResult(userId: string, view: TableView): void {
  bots.get(userId)?.observeResult(view);
}
