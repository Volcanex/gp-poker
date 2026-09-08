/* CFR+ over a street subgame, carrying whole ranges through the tree.

   One traversal per player per iteration. A traversal returns, for every combo
   the updating player might hold, the counterfactual value of the node: the
   chips it is worth given the opponent's reach probabilities, before the
   updating player's own reach is applied. Regrets and strategy sums live per
   decision node as flat `actions * combos` arrays.

   CFR+ rather than plain CFR: regrets are floored at zero after every update
   and the average strategy is weighted by the iteration number. On subgames
   this size that is worth roughly an order of magnitude of iterations, and it
   needs no tuning.

   Vectors are handed out by a bump allocator over one buffer. A river solve
   allocates a few dozen vectors per traversal and does a few hundred
   traversals a second, so allocating them from the heap would put the garbage
   collector on the critical path for no reason. */

import type { Universe } from './showdown.js';
import { accumulateShowdown, foldValues } from './showdown.js';
import type { DecisionNode, Node, Tree } from './tree.js';

/* What a terminal that reaches a showdown is worth. The river has one board
   and hands it straight to the sweep; the turn averages the sweep over a
   sample of river cards. Either way the caller owns the ranking, because
   ranking a board is the expensive part and it is reused across iterations. */
export interface ShowdownEvaluator {
  // out[i] += payoff * (opponent weight beaten - opponent weight beating us)
  evaluate(oppW: Float32Array, payoff: number, out: Float32Array): void;
  // Called once per iteration, so a sampling evaluator can redraw.
  nextIteration?(iteration: number): void;
}

class Arena {
  private buf: Float32Array;
  private ptr = 0;
  constructor(
    private width: number,
    slots: number
  ) {
    this.buf = new Float32Array(width * slots);
  }
  mark(): number {
    return this.ptr;
  }
  release(mark: number): void {
    this.ptr = mark;
  }
  alloc(): Float32Array {
    const start = this.ptr * this.width;
    if (start + this.width > this.buf.length) {
      const grown = new Float32Array(this.buf.length * 2);
      grown.set(this.buf);
      this.buf = grown;
    }
    this.ptr += 1;
    const v = this.buf.subarray(start, start + this.width);
    v.fill(0);
    return v;
  }
}

interface NodeStore {
  regret: Float32Array;
  strategySum: Float32Array;
  actions: number;
}

export interface CfrOptions {
  iterations?: number;
  budgetMs?: number;
  // Iterations between clock reads. A read per iteration is measurable on a
  // subgame that runs a thousand of them in a second.
  checkEvery?: number;
}

export class Cfr {
  private stores: NodeStore[] = [];
  private arena: Arena;
  private strategyStack: Float32Array[] = [];
  private strategyWidth: number;
  iterations = 0;

  constructor(
    readonly tree: Tree,
    readonly universe: Universe,
    readonly ranges: [Float32Array, Float32Array],
    private evaluator: ShowdownEvaluator
  ) {
    const n = universe.n;
    let maxActions = 1;
    for (const d of tree.decisions) {
      this.stores[d.id] = {
        regret: new Float32Array(d.acts.length * n),
        strategySum: new Float32Array(d.acts.length * n),
        actions: d.acts.length,
      };
      maxActions = Math.max(maxActions, d.acts.length);
    }
    this.arena = new Arena(n, 128);
    this.strategyWidth = maxActions * n;
  }

  run(options: CfrOptions = {}): number {
    const maxIterations = options.iterations ?? 100_000;
    const budget = options.budgetMs ?? Infinity;
    const checkEvery = options.checkEvery ?? 8;
    const started = Date.now();
    let done = 0;
    while (done < maxIterations) {
      this.iterations += 1;
      this.evaluator.nextIteration?.(this.iterations);
      for (const updater of [0, 1] as const) {
        const mark = this.arena.mark();
        this.traverse(this.tree.root, this.ranges[0], this.ranges[1], updater, this.iterations, 0);
        this.arena.release(mark);
      }
      done += 1;
      if (done % checkEvery === 0 && Date.now() - started >= budget) break;
    }
    return done;
  }

  /* Current strategy at a node, regret matched, written into `out` as
     `actions * combos`. CFR+ keeps regrets non negative, so the positive part
     is the whole of it. */
  private strategyAt(node: DecisionNode, out: Float32Array): void {
    const store = this.stores[node.id];
    const n = this.universe.n;
    const a = store.actions;
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = 0; k < a; k++) sum += store.regret[k * n + i];
      if (sum > 0) {
        const inv = 1 / sum;
        for (let k = 0; k < a; k++) out[k * n + i] = store.regret[k * n + i] * inv;
      } else {
        const flat = 1 / a;
        for (let k = 0; k < a; k++) out[k * n + i] = flat;
      }
    }
  }

  private strategyBufferAt(depth: number): Float32Array {
    let buf = this.strategyStack[depth];
    if (!buf) {
      buf = new Float32Array(this.strategyWidth);
      this.strategyStack[depth] = buf;
    }
    return buf;
  }

  /* Returns a vector that lives at the arena mark the call started from, so
     the caller frees it by releasing to that mark plus one. Everything else a
     traversal allocates is released before it returns. */
  private traverse(
    node: Node,
    reach0: Float32Array,
    reach1: Float32Array,
    updater: 0 | 1,
    iteration: number,
    depth: number
  ): Float32Array {
    const n = this.universe.n;
    const oppReach = updater === 0 ? reach1 : reach0;

    if (node.kind === 'fold') {
      const out = this.arena.alloc();
      // The folder loses the payoff, the other player wins it.
      foldValues(this.universe, oppReach, (node.folder === updater ? -1 : 1) * node.payoff, out);
      return out;
    }
    if (node.kind === 'showdown') {
      const out = this.arena.alloc();
      this.evaluator.evaluate(oppReach, node.payoff, out);
      return out;
    }

    const store = this.stores[node.id];
    const acts = node.acts.length;
    const strategy = this.strategyBufferAt(depth);
    this.strategyAt(node, strategy);

    const mark = this.arena.mark();
    // The first slot doubles as the reach vector handed to each child while
    // the loop runs and as the value vector returned once it is over.
    const result = this.arena.alloc();
    const values: Float32Array[] = [];
    for (let k = 0; k < acts; k++) values.push(this.arena.alloc());
    const subMark = this.arena.mark();

    const myReach = node.player === 0 ? reach0 : reach1;
    for (let k = 0; k < acts; k++) {
      const base = k * n;
      for (let i = 0; i < n; i++) result[i] = myReach[i] * strategy[base + i];
      const child =
        node.player === 0
          ? this.traverse(node.children[k], result, reach1, updater, iteration, depth + 1)
          : this.traverse(node.children[k], reach0, result, updater, iteration, depth + 1);
      values[k].set(child);
      this.arena.release(subMark);
    }

    if (node.player === updater) {
      for (let i = 0; i < n; i++) {
        let v = 0;
        for (let k = 0; k < acts; k++) v += strategy[k * n + i] * values[k][i];
        result[i] = v;
      }
      const reachMe = updater === 0 ? reach0 : reach1;
      for (let k = 0; k < acts; k++) {
        const base = k * n;
        for (let i = 0; i < n; i++) {
          const r = store.regret[base + i] + values[k][i] - result[i];
          store.regret[base + i] = r > 0 ? r : 0;
          store.strategySum[base + i] += iteration * reachMe[i] * strategy[base + i];
        }
      }
    } else {
      for (let i = 0; i < n; i++) {
        let v = 0;
        for (let k = 0; k < acts; k++) v += values[k][i];
        result[i] = v;
      }
    }

    this.arena.release(mark + 1);
    return result;
  }

  /* The average strategy at a node, which is the one that converges. */
  averageStrategy(node: DecisionNode): Float32Array {
    const store = this.stores[node.id];
    const n = this.universe.n;
    const a = store.actions;
    const out = new Float32Array(a * n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = 0; k < a; k++) sum += store.strategySum[k * n + i];
      if (sum > 0) {
        const inv = 1 / sum;
        for (let k = 0; k < a; k++) out[k * n + i] = store.strategySum[k * n + i] * inv;
      } else {
        const flat = 1 / a;
        for (let k = 0; k < a; k++) out[k * n + i] = flat;
      }
    }
    return out;
  }

  /* How much a perfect opponent could win against the average strategy, in
     chips per hand, summed over both seats and halved. Zero at equilibrium.
     Not called in a live decision: it costs a full traversal per player and
     exists so the convergence numbers in CLAUDE.md are measured rather than
     asserted. */
  exploitability(evaluator: ShowdownEvaluator = this.evaluator): number {
    const n = this.universe.n;
    const previous = this.evaluator;
    this.evaluator = evaluator;
    const averages = new Map<number, Float32Array>();
    for (const d of this.tree.decisions) averages.set(d.id, this.averageStrategy(d));

    const br = (brPlayer: 0 | 1): number => {
      const values = this.bestResponse(this.tree.root, this.ranges[0], this.ranges[1], brPlayer, averages);
      const mine = this.ranges[brPlayer];
      let total = 0;
      for (let i = 0; i < n; i++) total += mine[i] * values[i];
      return total;
    };

    const z = this.pairMass();
    const value = z <= 0 ? 0 : (br(0) + br(1)) / (2 * z);
    this.evaluator = previous;
    return value;
  }

  /* Total probability mass of the (hero combo, villain combo) pairs that can
     both be dealt, which is what every counterfactual value is scaled by. */
  private pairMass(): number {
    const n = this.universe.n;
    const [h, v] = this.ranges;
    const card = new Float64Array(52);
    let total = 0;
    for (let i = 0; i < n; i++) {
      total += v[i];
      card[this.universe.cardA[i]] += v[i];
      card[this.universe.cardB[i]] += v[i];
    }
    let z = 0;
    for (let i = 0; i < n; i++) {
      z += h[i] * (total - card[this.universe.cardA[i]] - card[this.universe.cardB[i]] + v[i]);
    }
    return z;
  }

  private bestResponse(
    node: Node,
    reach0: Float32Array,
    reach1: Float32Array,
    brPlayer: 0 | 1,
    averages: Map<number, Float32Array>
  ): Float32Array {
    const n = this.universe.n;
    const oppReach = brPlayer === 0 ? reach1 : reach0;

    if (node.kind === 'fold') {
      const out = new Float32Array(n);
      foldValues(this.universe, oppReach, (node.folder === brPlayer ? -1 : 1) * node.payoff, out);
      return out;
    }
    if (node.kind === 'showdown') {
      const out = new Float32Array(n);
      this.evaluator.evaluate(oppReach, node.payoff, out);
      return out;
    }

    const acts = node.acts.length;
    const strategy = averages.get(node.id)!;
    const values: Float32Array[] = [];
    for (let k = 0; k < acts; k++) {
      if (node.player === brPlayer) {
        values.push(this.bestResponse(node.children[k], reach0, reach1, brPlayer, averages));
      } else {
        const scaled = new Float32Array(n);
        const source = node.player === 0 ? reach0 : reach1;
        for (let i = 0; i < n; i++) scaled[i] = source[i] * strategy[k * n + i];
        values.push(
          node.player === 0
            ? this.bestResponse(node.children[k], scaled, reach1, brPlayer, averages)
            : this.bestResponse(node.children[k], reach0, scaled, brPlayer, averages)
        );
      }
    }

    const out = new Float32Array(n);
    if (node.player === brPlayer) {
      for (let i = 0; i < n; i++) {
        let best = -Infinity;
        for (let k = 0; k < acts; k++) if (values[k][i] > best) best = values[k][i];
        out[i] = best;
      }
    } else {
      for (let i = 0; i < n; i++) {
        let v = 0;
        for (let k = 0; k < acts; k++) v += values[k][i];
        out[i] = v;
      }
    }
    return out;
  }
}
