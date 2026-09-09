/* Convergence and timing for the three subgame solves, printed rather than
   asserted: the numbers in CLAUDE.md come from here.

   Exploitability is how much a perfect opponent could win against the average
   strategy, per hand, as a share of the pot the street started with. It is
   measured inside the tree the solver builds, so it says the solve converged,
   not that the bet size set is complete. Turn and flop are measured against
   every runout there is rather than against the sample the solve trained on,
   which is the honest number for the depth limited leaf.

   npx tsx packages/solver/scripts/bench.ts */

import type { Card } from '@opentable/protocol';
import { cardIndex } from '../src/cards.js';
import { rangeFromPercentiles, removeBlocked } from '../src/range.js';
import { fullRunoutEvaluator, solveSubgame, type SubgameSpec } from '../src/solve.js';

function cards(list: string[]): number[] {
  return list.map((c) => cardIndex(c as Card));
}

function run(label: string, board: number[], pot: number, budgets: number[]): void {
  const hero = removeBlocked(rangeFromPercentiles(0, 30), board);
  const villain = removeBlocked(rangeFromPercentiles(0, 45), board);
  const spec: SubgameSpec = {
    board,
    heroRange: hero,
    villainRange: villain,
    hero: 0,
    pot,
    committed: [0, 0],
    stack: 100,
    toAct: 0,
    minBet: 2,
    minRaiseTo: 2,
    actedThisRound: false,
  };
  console.log(`${label}, pot ${pot}, stack 100, ranges 30% and 45%`);
  for (const budgetMs of budgets) {
    const result = solveSubgame(spec, { budgetMs });
    const evaluator = board.length >= 5 ? undefined : fullRunoutEvaluator(result.universe, board);
    const exploitability = result.cfr.exploitability(evaluator);
    console.log(
      `  budget ${String(budgetMs).padStart(4)}ms  combos ${result.universe.n}` +
        `  nodes ${result.tree.decisions.length}  iterations ${String(result.iterations).padStart(5)}` +
        `  ${result.ms}ms  exploitable ${((exploitability / pot) * 100).toFixed(2)}% of pot`
    );
  }
}

run('river', cards(['Ah', 'Kd', '7c', '2s', '9h']), 60, [50, 100, 200, 300, 500, 1000]);
run('turn', cards(['Ah', 'Kd', '7c', '2s']), 40, [300, 500, 1000, 1500]);
run('flop', cards(['Ah', 'Kd', '7c']), 20, [500, 1000, 1500]);
