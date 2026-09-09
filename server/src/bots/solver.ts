/* The tiers that have to think.

   The five instant tiers are one pure function and answer in microseconds.
   `regular` and `solver` track both ranges through the hand and run CFR+ on a
   street in front of them, which is hundreds of milliseconds of processor
   time, so they need three things the others do not: state that lives across a
   hand, a clock, and somewhere to run that is not "all of it, right now".

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

   Two solves at a time. A third falls back to the sharp tier rather than
   making all three slow: a bot that answers in time with a worse decision
   beats a bot that answers late. */

import { SolverBot, type PreparedSubgame } from '@opentable/solver';
import { LEVEL_TIER, type BotLevel, type BotTier, type TableView } from '@opentable/protocol';
import { decide, ensureLegal, type BotDecision, type Rng } from './strategy.js';

export type ThinkingTier = Extract<BotTier, 'regular' | 'solver'>;

/* Which of the thinking tiers a level plays, or null for the five that answer
   instantly. Everything here reads the tier and never the number, so moving a
   tier up or down the ladder is an edit to LEVEL_TIER alone. */
export function thinkingTier(level: BotLevel): ThinkingTier | null {
  const tier = LEVEL_TIER[level];
  return tier === 'regular' || tier === 'solver' ? tier : null;
}

/* Never think for longer than this, whatever the clock allows. Past about a
   second the solver tier's curve is flat (see packages/solver/CLAUDE.md) and
   the rest is processor nobody gets anything for. The regular tier solves only
   the river, which converges in a fraction of that, and spends what it saves
   on being a bot that can sit at more tables. */
const MAX_BUDGET_MS: Record<ThinkingTier, number> = { regular: 400, solver: 1500 };
const CLOCK_FRACTION = 4;

/* The ladder plays bots against each other in the gaps when nobody is here,
   one match after another, forever. Two thinking accounts meeting on it at the
   full budget would keep a core busy around the clock on a four core box that
   also runs everything else Gabriel has. Nobody is watching a ladder match, so
   it gets a fraction of the thinking time and a slightly worse bot. */
const LADDER_BUDGET_MS = 250;

// How long a slice runs before it hands the event loop back.
const SLICE_MS = 8;

const MAX_CONCURRENT = 2;

let running = 0;

const bots = new Map<string, SolverBot>();

function botFor(userId: string, tier: ThinkingTier, level: BotLevel): SolverBot {
  let bot = bots.get(userId);
  if (!bot) {
    // The fallback is the same pure function every other tier uses, asked for
    // this level: `decide` maps a thinking tier onto the sharp one, so the
    // streets this tier does not solve are played by the tier below it.
    bot = new SolverBot({ tier, fallback: (v, r) => decide(v, r, level) });
    bots.set(userId, bot);
  }
  return bot;
}

export function budgetFor(clockMs: number, tier: ThinkingTier = 'solver', ladder = false): number {
  const ceiling = Math.min(MAX_BUDGET_MS[tier], ladder ? LADDER_BUDGET_MS : Infinity);
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

/* One action, or null when this process is already thinking as hard as it is
   willing to. Null means the caller should ask the pure function instead,
   which is what player.ts does. The bot itself never returns null: it owns the
   whole hand and asks its own fallback for the streets it does not solve. */
export async function decideSolver(
  userId: string,
  view: TableView,
  rng: Rng,
  level: BotLevel
): Promise<BotDecision | null> {
  const tier = thinkingTier(level);
  if (!tier) return null;
  if (running >= MAX_CONCURRENT) return null;
  const bot = botFor(userId, tier, level);
  running += 1;
  try {
    const budget = budgetFor(view.format.clockMs, tier, view.format.ladder === true);
    const decision = await bot.decide(view, rng, slicedRunner, budget);
    // Same gate every other tier leaves through. The solver clamps against
    // the legal window itself, so this is a guarantee rather than a fix, and
    // it is the sort of guarantee that should not depend on a package outside
    // this directory continuing to be careful.
    return ensureLegal(decision, view.legal!);
  } catch (err) {
    // A bot that throws must not take the table with it. The sharp tier
    // answers instead, and the reason is on the record.
    console.error(`${tier} tier decision failed: ${err instanceof Error ? err.message : String(err)}`);
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
