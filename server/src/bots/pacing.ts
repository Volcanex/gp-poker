import { speedOf, type MatchFormat, type Street, type TableView } from '@opentable/protocol';
import type { BotDecision } from './strategy.js';

/* How long a bot spends over a decision, and why. Two questions, asked in
   order: which range applies (`thinkRange`, by format and whether the
   decision is free), and where inside that range a real decision lands
   (`spotThinkMs`, by how big the decision reads). Both are pure: no clock,
   no rng seeded here, so `player.ts`'s timer is the only place that runs
   real time and every branch below is reachable from a plain object. */

const THINK_MIN_MS = 600;
const THINK_MAX_MS = 1800;
const QUICK_MIN_MS = 100;
const QUICK_MAX_MS = 400;

// A practice table is a person against bots, so bots there think longer than
// they need to: fast enough not to be dull, slow enough that a hand reads as
// something happening rather than a wall of text. The quick range (a check,
// a call that costs nothing) is roughly doubled rather than left alone, for
// the same reason.
const PRACTICE_THINK_MIN_MS = 1400;
const PRACTICE_THINK_MAX_MS = 3200;
const PRACTICE_QUICK_MIN_MS = 200;
const PRACTICE_QUICK_MAX_MS = 800;

// A standard table is the slow game: a twenty second clock, blinds that sit
// still, a match measured in hands rather than in minutes. A bot answering
// it in under a second is the tell, whoever is at the table and whether they
// are playing or spectating, so a standard seat is paced like somebody
// actually looking at the board. The fast tables keep the ranges above:
// there the point is that it is over quickly, and a considered pause reads
// as lag rather than as thought.
const STANDARD_THINK_MIN_MS = 1200;
const STANDARD_THINK_MAX_MS = 3400;
const STANDARD_QUICK_MIN_MS = 300;
const STANDARD_QUICK_MAX_MS = 900;

/* Which range applies. `humanPresent` is asked first and decides everything
   else: nobody is fooled by a bot-only table, whatever its format says, so a
   population match two bots landed in through the ordinary queue, or a
   ladder match, or any other table with no person at it plays at the
   throughput ranges regardless of its speed. This used to be a check for
   `format.ladder` specifically; that was really always a proxy for "nobody
   is watching", and reading the fact directly (`player.ts` asks the loaded
   roster, not the wire's own `bot` field, which is masked to false for the
   population once it is public) covers the ladder and every other bot-only
   table the same way, including ones the ladder's own flag knows nothing
   about. */
export function thinkRange(format: MatchFormat, trivial: boolean, humanPresent = true): [number, number] {
  if (!humanPresent) return trivial ? [QUICK_MIN_MS, QUICK_MAX_MS] : [THINK_MIN_MS, THINK_MAX_MS];
  if (format.practice === true) {
    return trivial
      ? [PRACTICE_QUICK_MIN_MS, PRACTICE_QUICK_MAX_MS]
      : [PRACTICE_THINK_MIN_MS, PRACTICE_THINK_MAX_MS];
  }
  if (speedOf(format) === 'standard') {
    return trivial
      ? [STANDARD_QUICK_MIN_MS, STANDARD_QUICK_MAX_MS]
      : [STANDARD_THINK_MIN_MS, STANDARD_THINK_MAX_MS];
  }
  return trivial ? [QUICK_MIN_MS, QUICK_MAX_MS] : [THINK_MIN_MS, THINK_MAX_MS];
}

// How much of a decision each street reads as on its own, before the price
// is weighed in: preflop is mostly muscle memory, the river is where a hand
// is actually won or lost.
const STREET_WEIGHT: Record<Street, number> = { pre: 0.1, flop: 0.4, turn: 0.7, river: 1, showdown: 0, done: 0 };
const STREET_SHARE = 0.4;
const STAKE_SHARE = 0.6;

/* How big a non-trivial decision reads, 0 to 1: a later street and a costlier
   price both push it up. A call or a fold is judged against what is left
   behind (`legal.call` over the seat's own stack, so a small call late with
   a short stack still reads as light and a min-raise with a full stack still
   reads as light the other way); a bet or a raise is judged against the
   legal range itself (`v` between `legal.min` and `legal.max`), because a
   shove and a min-raise are the same number of chips at two different stack
   depths and only the second one is a real decision. Callers only ask this
   for a decision that is already known not to be free (`trivial` below), so
   it never has to account for a check. */
export function spotWeight(view: TableView, decision: BotDecision): number {
  const legal = view.legal;
  if (!legal || view.you === null) return 0.5;
  const me = view.seats[view.you];
  const street = STREET_WEIGHT[view.street] ?? 0.5;

  let stake = 0;
  if (decision.a === 'c' || decision.a === 'f') {
    stake = legal.call / Math.max(1, me.stack);
  } else if (decision.a === 'a') {
    // An all-in carries no `v` (`ensureLegal` never gives it one, see
    // `strategy.ts`): it is the whole stack by definition, whether framed as
    // a call or a raise, so it reads as the biggest stake there is.
    stake = 1;
  } else if (decision.v !== undefined) {
    const span = Math.max(1, legal.max - legal.min);
    stake = (decision.v - legal.min) / span;
  }

  return Math.min(1, Math.max(0, STREET_SHARE * street + STAKE_SHARE * Math.min(1, stake)));
}

// Jitter as a fraction of the range's own width, so six bots weighing
// similar spots at the same table do not land on the same instant: the
// weighted point is a target, not a promise.
const SPOT_JITTER_FRACTION = 0.3;

// Where in [lo, hi] a non-trivial decision lands. Pure and rng-injected, so
// the same view and the same rng sequence always land on the same number.
export function spotThinkMs(view: TableView, decision: BotDecision, lo: number, hi: number, rng: () => number): number {
  const span = hi - lo;
  const base = lo + spotWeight(view, decision) * span;
  const jitter = (rng() - 0.5) * span * SPOT_JITTER_FRACTION;
  return Math.min(hi, Math.max(lo, base + jitter));
}
