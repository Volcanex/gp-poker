/* How much one level beats another, in big blinds per hundred hands, with an
   interval around it. The level ordering test says the levels are ordered; this
   says by how much, which is the only claim worth making about level 6.

   The design is the ordering test's: every deal is played four times, both
   seatings and both buttons, with the two seatings sharing a decision stream
   from the same starting state. Identical strategies then cancel to exactly
   zero, so what is left is where the two levels actually decide differently.
   One sample is one (deal, button) pair, which is two hands, and the interval
   is the standard error over those samples.

   Level 6 thinks, so the budget it thinks on is the headline setting. The
   default here is well under the 1500ms a live table gives it, because a run
   long enough to say anything at 1500ms takes hours; a smaller budget makes
   level 6 worse, so every number below is a floor rather than a ceiling.

     npx tsx server/scripts/bench-bots.ts
     BOT_BENCH_DEALS=400 BOT_BENCH_BUDGET_MS=500 npx tsx server/scripts/bench-bots.ts */

import { formatFor, type BotLevel } from '@opentable/protocol';
import { brainForLevel, mulberry32, playHand, seedFrom } from '../src/bots/simulate.js';

const DEALS = Number(process.env.BOT_BENCH_DEALS ?? 200);
const BUDGET_MS = Number(process.env.BOT_BENCH_BUDGET_MS ?? 250);
const STACKS = (process.env.BOT_BENCH_STACKS ?? '30,100').split(',').map(Number);
const FORMAT = formatFor('heads-up', false);
const SB = 1;
const BB = 2;

interface Result {
  bb100: number;
  se: number;
  hands: number;
  latency: number[];
}

async function matchup(a: BotLevel, b: BotLevel, stackBb: number, deals: number): Promise<Result> {
  const stack = stackBb * BB;
  const brains = new Map<BotLevel, ReturnType<typeof brainForLevel>>([
    [a, brainForLevel(a, BUDGET_MS)],
    [b, brainForLevel(b, BUDGET_MS)],
  ]);
  const rng = mulberry32(1000 * a + b + stackBb);
  const samples: number[] = [];
  const latency: number[] = [];
  let hand = 0;

  for (let d = 0; d < deals; d++) {
    const seed = seedFrom(rng);
    for (const button of [0, 1]) {
      const draw = 7_000_003 * a + 101 * b + 2 * d + button;
      const setup = { stack, sb: SB, bb: BB, button, seed };
      const options = { format: FORMAT, matchId: `m${a}v${b}` };
      const first = await playHand(
        [brains.get(a)!, brains.get(b)!],
        setup,
        { ...options, handNumber: ++hand },
        mulberry32(draw)
      );
      const second = await playHand(
        [brains.get(b)!, brains.get(a)!],
        setup,
        { ...options, handNumber: ++hand },
        mulberry32(draw)
      );
      samples.push(first.chips[0] + second.chips[1]);
      latency.push(...first.latency[0], ...second.latency[1]);
    }
  }

  const n = samples.length;
  const mean = samples.reduce((s, v) => s + v, 0) / n;
  const variance = samples.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, n - 1);
  // Two hands per sample, so a sample's chips are twice a hand's.
  const scale = 50 / BB;
  return { bb100: scale * mean, se: (scale * Math.sqrt(variance)) / Math.sqrt(n), hands: 2 * n, latency };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

async function main(): Promise<void> {
  console.log(`deals per matchup ${DEALS}, solver budget ${BUDGET_MS}ms, blinds ${SB}/${BB}`);
  console.log('matchup            stack   hands      bb/100      SE   p50ms   p95ms');
  const pairs: [BotLevel, BotLevel][] = [
    [6, 5],
    [6, 4],
    [5, 4],
  ];
  for (const stackBb of STACKS) {
    for (const [a, b] of pairs) {
      const started = Date.now();
      const r = await matchup(a, b, stackBb, DEALS);
      const label = `level ${a} vs level ${b}`.padEnd(19);
      console.log(
        `${label}${String(stackBb).padStart(4)}bb ${String(r.hands).padStart(7)} ` +
          `${r.bb100.toFixed(1).padStart(11)} ${r.se.toFixed(1).padStart(7)} ` +
          `${String(percentile(r.latency, 0.5)).padStart(7)} ${String(percentile(r.latency, 0.95)).padStart(7)}` +
          `   (${Math.round((Date.now() - started) / 1000)}s)`
      );
    }
  }
}

await main();
