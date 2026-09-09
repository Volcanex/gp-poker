/* The public betting tree of one street of a heads-up subgame.

   A node is a decision (whose turn, which actions) or a terminal. Nothing in
   here knows about cards: the tree is the same whatever the two players hold,
   which is exactly what lets a solve carry whole ranges through it in one
   traversal instead of one hand at a time.

   Contributions are totals for this street. `stack` is the cap on either
   player's street contribution, so the two are always able to match each
   other and a call never leaves a side pot: heads-up with equal effective
   stacks that is the truth, and the effective stack is what the caller
   passes.

   Terminal payoffs are signed from the point of view of whoever wins, and are
   measured against splitting the pot rather than against zero: a showdown win
   with `c` in front of each player and `P` in the pot before the street is
   worth `P / 2 + c`. Both players are offset by the same `P / 2`, so the game
   stays zero sum and every regret is unchanged. */

export type ActionLabel = 'f' | 'x' | 'c' | 'b' | 'r' | 'a';

export interface Act {
  label: ActionLabel;
  to: number; // total street contribution after the action
}

export interface DecisionNode {
  kind: 'decision';
  player: 0 | 1;
  acts: Act[];
  children: Node[];
  id: number;
}

export interface FoldNode {
  kind: 'fold';
  folder: 0 | 1;
  payoff: number; // to the winner
}

export interface ShowdownNode {
  kind: 'showdown';
  payoff: number; // to the winner of the showdown
}

export type Node = DecisionNode | FoldNode | ShowdownNode;

export interface TreeSpec {
  pot: number; // chips in the pot before this street's contributions
  stack: number; // cap on each player's street contribution
  committed: [number, number];
  toAct: 0 | 1;
  minBet: number; // one big blind: the smallest bet the engine allows
  minRaiseTo: number; // smallest legal raise-to given the street so far
  actedThisRound: boolean; // the other player has already acted with no bet live
  betSizes: number[]; // fractions of the pot when first in
  raiseSizes: number[]; // fractions of the pot after calling, when facing a bet
  raiseCap: number; // raises allowed on this street, all-in included
  /* All-in is only offered while what is behind is at most this many times the
     pot. Deep on the flop and the turn the value of a stack-off comes almost
     entirely from the depth limited leaf, which is the part of this solver
     that is least trustworthy, so the option is simply not there. On the
     river, where the solve is exact, it always is. */
  allInSpr: number;
}

export const DEFAULT_BET_SIZES = [0.33, 0.75, 1.5];
export const DEFAULT_RAISE_SIZES = [0.9];
export const DEFAULT_RAISE_CAP = 2;
export const DEFAULT_ALL_IN_SPR = 4;

// A bet this close to the whole stack is an all-in with extra steps, and
// keeping both makes the tree wider for no strategic gain.
const ALL_IN_SNAP = 0.85;

export interface Tree {
  root: Node;
  decisions: DecisionNode[];
}

export function buildTree(spec: TreeSpec): Tree {
  const decisions: DecisionNode[] = [];

  function build(
    committed: [number, number],
    toAct: 0 | 1,
    raises: number,
    minRaiseTo: number,
    actedThisRound: boolean
  ): Node {
    const opp = (1 - toAct) as 0 | 1;
    const facing = committed[opp] - committed[toAct];
    const potNow = spec.pot + committed[0] + committed[1];
    const acts: Act[] = [];
    const children: Node[] = [];

    const push = (act: Act, child: Node) => {
      acts.push(act);
      children.push(child);
    };

    if (facing <= 0) {
      // Checking either passes the decision over or ends the street.
      if (actedThisRound) {
        push({ label: 'x', to: committed[toAct] }, { kind: 'showdown', payoff: spec.pot / 2 + committed[toAct] });
      } else {
        push({ label: 'x', to: committed[toAct] }, build(committed, opp, raises, minRaiseTo, true));
      }
      if (raises < spec.raiseCap && spec.stack > committed[toAct]) {
        for (const to of betTargets(spec, committed[toAct], potNow, spec.minBet)) {
          const next: [number, number] = toAct === 0 ? [to, committed[1]] : [committed[0], to];
          const raiseSize = to - committed[toAct];
          push(
            { label: to >= spec.stack ? 'a' : 'b', to },
            build(next, opp, raises + 1, Math.min(spec.stack, to + raiseSize), true)
          );
        }
      }
    } else {
      push({ label: 'f', to: committed[toAct] }, { kind: 'fold', folder: toAct, payoff: spec.pot / 2 + committed[toAct] });
      const callTo = Math.min(committed[opp], spec.stack);
      push({ label: 'c', to: callTo }, { kind: 'showdown', payoff: spec.pot / 2 + callTo });
      if (raises < spec.raiseCap && spec.stack > committed[opp]) {
        const potAfterCall = potNow + facing;
        for (const to of raiseTargets(spec, committed[opp], potAfterCall, minRaiseTo)) {
          const next: [number, number] = toAct === 0 ? [to, committed[1]] : [committed[0], to];
          const raiseSize = to - committed[opp];
          push(
            { label: to >= spec.stack ? 'a' : 'r', to },
            build(next, opp, raises + 1, Math.min(spec.stack, to + raiseSize), true)
          );
        }
      }
    }

    const node: DecisionNode = { kind: 'decision', player: toAct, acts, children, id: decisions.length };
    decisions.push(node);
    return node;
  }

  const root = build(spec.committed, spec.toAct, 0, spec.minRaiseTo, spec.actedThisRound);
  return { root, decisions };
}

function betTargets(spec: TreeSpec, from: number, potNow: number, minBet: number): number[] {
  const out: number[] = [];
  for (const f of spec.betSizes) {
    const to = from + Math.max(minBet, Math.round(f * potNow));
    if (to >= spec.stack * ALL_IN_SNAP) continue;
    if (to <= from) continue;
    out.push(to);
  }
  if (spec.stack - from <= spec.allInSpr * potNow) out.push(spec.stack);
  return dedupe(out.length > 0 ? out : [spec.stack]);
}

function raiseTargets(spec: TreeSpec, facingTo: number, potAfterCall: number, minRaiseTo: number): number[] {
  const out: number[] = [];
  for (const f of spec.raiseSizes) {
    const to = Math.max(minRaiseTo, facingTo + Math.round(f * potAfterCall));
    if (to >= spec.stack * ALL_IN_SNAP) continue;
    if (to <= facingTo) continue;
    out.push(to);
  }
  // An all-in short of the minimum raise is still legal, and the caller has
  // already checked it is a raise at all.
  if (spec.stack - facingTo <= spec.allInSpr * potAfterCall) out.push(spec.stack);
  return dedupe(out);
}

function dedupe(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

export function countNodes(tree: Tree): number {
  return tree.decisions.length;
}
