/* Walks the preflop portion of a heads-up hand's action log. Blind posts are
   never logged (the engine posts them itself), so the first logged action is
   always the button's (button = small blind heads-up). The two seats
   alternate every decision, so position is fixed for the whole hand: the
   button seat is 'sb', the other is 'bb'.

   raiseCount tracks how many raises have happened so far; combined with
   position it picks out the named spot (sb_open is raiseCount 0 for sb,
   bb_vs_open is raiseCount 1 for bb, and so on). A limp (sb calls at
   raiseCount 0) does not close the betting round, since bb still has a free
   option; every other call, or a check behind a limp, closes it. A fold ends
   the hand outright. The walk stops the moment the round closes, which is
   also the moment the street would turn to flop, so nothing postflop is
   ever read even if the caller hands over the full action log. */

import type { ActionKind, LoggedAction } from '@opentable/protocol';
import type { Decision, SeatStats, Spot, StackBucket, DecisionAction } from './types.js';
import { handClass } from './hand.js';
import { scoreDecision } from './score.js';

export interface ExtractConfig {
  seats: { stack: number }[];
  button: number;
  bb: number;
}

export interface PreflopStep {
  seat: number;
  position: 'sb' | 'bb';
  raiseCount: number;
  kind: ActionKind;
  category: DecisionAction;
}

function categoryOf(a: ActionKind): DecisionAction {
  if (a === 'f') return 'fold';
  if (a === 'c' || a === 'x') return 'passive';
  return 'aggr'; // b, r, a
}

export function bucketFor(effStackBb: number): StackBucket {
  if (effStackBb >= 60) return 'deep';
  if (effStackBb >= 25) return 'mid';
  if (effStackBb >= 12) return 'short';
  return 'push';
}

export function effectiveStackBb(config: ExtractConfig): number {
  return Math.min(...config.seats.map((s) => s.stack)) / config.bb;
}

export function spotFor(bucket: StackBucket, position: 'sb' | 'bb', raiseCount: number): Spot | null {
  if (bucket === 'push') {
    if (position === 'sb' && raiseCount === 0) return 'sb_push';
    if (position === 'bb' && raiseCount === 1) return 'bb_vs_push';
    return null;
  }
  if (position === 'sb' && raiseCount === 0) return 'sb_open';
  if (position === 'bb' && raiseCount === 1) return 'bb_vs_open';
  if (position === 'sb' && raiseCount === 2) return 'sb_vs_3bet';
  if (position === 'bb' && raiseCount === 3) return 'bb_vs_4bet';
  return null;
}

export function walkPreflop(config: ExtractConfig, actions: LoggedAction[]): PreflopStep[] {
  const steps: PreflopStep[] = [];
  let raiseCount = 0;
  let sbHasLimped = false;

  for (const act of actions) {
    const position: 'sb' | 'bb' = act.s === config.button ? 'sb' : 'bb';
    const category = categoryOf(act.a);
    steps.push({ seat: act.s, position, raiseCount, kind: act.a, category });

    if (category === 'fold') break;

    if (category === 'aggr') {
      raiseCount += 1;
      sbHasLimped = false;
      continue;
    }

    // category === 'passive': a call or a check.
    if (raiseCount === 0 && !sbHasLimped) {
      // This is sb's opening limp; bb still has a free option, round stays open.
      sbHasLimped = true;
      continue;
    }
    // Either bb checked behind the limp, or someone called a live raise: closed.
    break;
  }

  return steps;
}

export function extractDecisions(
  config: ExtractConfig,
  actions: LoggedAction[],
  holes: Record<number, [string, string]>
): Decision[] {
  const bucket = bucketFor(effectiveStackBb(config));
  const steps = walkPreflop(config, actions);
  const decisions: Decision[] = [];

  for (const step of steps) {
    const spot = spotFor(bucket, step.position, step.raiseCount);
    if (!spot) continue;
    const hole = holes[step.seat];
    if (!hole) continue;
    const hand = handClass(hole);
    const { best, evLost, inRange } = scoreDecision({ spot, bucket, hand, action: step.category });
    decisions.push({ seat: step.seat, spot, bucket, hand, action: step.category, best, evLost, inRange });
  }

  return decisions;
}

export function handStats(
  config: ExtractConfig,
  actions: LoggedAction[],
  _holes?: Record<number, [string, string]>
): Record<number, SeatStats> {
  const stats: Record<number, SeatStats> = {};
  for (let i = 0; i < config.seats.length; i++) {
    stats[i] = { vpip: false, pfr: false, aggr: 0, passive: 0, faced3bet: false, foldTo3bet: false };
  }

  for (const step of walkPreflop(config, actions)) {
    const s = stats[step.seat];
    if (!s) continue;
    if (step.category === 'aggr' || step.kind === 'c') s.vpip = true;
    if (step.category === 'aggr') s.pfr = true;
    if (step.raiseCount === 2) {
      s.faced3bet = true;
      if (step.category === 'fold') s.foldTo3bet = true;
    }
  }

  for (const act of actions) {
    const s = stats[act.s];
    if (!s) continue;
    if (act.a === 'b' || act.a === 'r' || act.a === 'a') s.aggr += 1;
    else if (act.a === 'c' || act.a === 'x') s.passive += 1;
  }

  return stats;
}
