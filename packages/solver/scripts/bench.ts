/* Convergence and timing for the two subgame solves, printed rather than
   asserted: the numbers in CLAUDE.md come from here.

   npx tsx packages/solver/scripts/bench.ts */

import type { Card } from '@opentable/protocol';
import { cardIndex } from '../src/cards.js';
import { rangeFromPercentiles, removeBlocked } from '../src/range.js';
import { solveSubgame } from '../src/solve.js';

function cards(list: string[]): number[] {
  return list.map((c) => cardIndex(c as Card));
}

function river(): void {
  const board = cards(['Ah', 'Kd', '7c', '2s', '9h']);
  const hero = removeBlocked(rangeFromPercentiles(0, 30), board);
  const villain = removeBlocked(rangeFromPercentiles(0, 45), board);
  console.log('river, pot 60, stack 100, ranges 30% and 45%');
  for (const budgetMs of [50, 100, 200, 300, 500, 1000]) {
    const result = solveSubgame(
      {
        board,
        heroRange: hero,
        villainRange: villain,
        hero: 0,
        pot: 60,
        committed: [0, 0],
        stack: 100,
        toAct: 0,
        minBet: 2,
        minRaiseTo: 2,
        actedThisRound: false,
      },
      { budgetMs }
    );
    const exploitability = result.cfr.exploitability();
    console.log(
      `  budget ${String(budgetMs).padStart(4)}ms  combos ${result.universe.n}  nodes ${result.tree.decisions.length}` +
        `  iterations ${String(result.iterations).padStart(5)}  ${result.ms}ms` +
        `  exploitable ${((exploitability / 60) * 100).toFixed(2)}% of pot`
    );
  }
}

function turn(): void {
  const board = cards(['Ah', 'Kd', '7c', '2s']);
  const hero = removeBlocked(rangeFromPercentiles(0, 30), board);
  const villain = removeBlocked(rangeFromPercentiles(0, 45), board);
  console.log('turn, pot 40, stack 100, ranges 30% and 45%');
  for (const budgetMs of [200, 500, 1000]) {
    const result = solveSubgame(
      {
        board,
        heroRange: hero,
        villainRange: villain,
        hero: 0,
        pot: 40,
        committed: [0, 0],
        stack: 100,
        toAct: 0,
        minBet: 2,
        minRaiseTo: 2,
        actedThisRound: false,
      },
      { budgetMs }
    );
    const exploitability = result.cfr.exploitability();
    console.log(
      `  budget ${String(budgetMs).padStart(4)}ms  combos ${result.universe.n}  nodes ${result.tree.decisions.length}` +
        `  iterations ${String(result.iterations).padStart(5)}  ${result.ms}ms` +
        `  exploitable ${((exploitability / 40) * 100).toFixed(2)}% of pot (against the depth limited leaf)`
    );
  }
}

river();
turn();
