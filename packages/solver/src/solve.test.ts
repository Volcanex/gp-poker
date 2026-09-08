import { describe, expect, it } from 'vitest';
import type { Card } from '@opentable/protocol';
import { cardIndex, comboIndex } from './cards.js';
import { emptyRange, rangeFromPercentiles, removeBlocked } from './range.js';
import { frequenciesFor, fullRunoutEvaluator, solveSubgame, type SubgameSpec } from './solve.js';

function cards(list: string[]): number[] {
  return list.map((c) => cardIndex(c as Card));
}

const RIVER = cards(['Ah', 'Kd', '7c', '2s', '9h']);

function riverSpec(over: Partial<SubgameSpec> = {}): SubgameSpec {
  return {
    board: RIVER,
    heroRange: removeBlocked(rangeFromPercentiles(0, 30), RIVER),
    villainRange: removeBlocked(rangeFromPercentiles(0, 45), RIVER),
    hero: 0,
    pot: 60,
    committed: [0, 0],
    stack: 100,
    toAct: 0,
    minBet: 2,
    minRaiseTo: 2,
    actedThisRound: false,
    ...over,
  };
}

describe('subgame solve', () => {
  it('converges on the river and is measurably close to unexploitable', () => {
    const short = solveSubgame(riverSpec(), { iterations: 20 });
    const long = solveSubgame(riverSpec(), { iterations: 600 });
    const early = short.cfr.exploitability();
    const late = long.cfr.exploitability();
    expect(late).toBeLessThan(early);
    // Inside the tree it solves, which is the only claim it makes.
    expect(late / 60).toBeLessThan(0.005);
  }, 30_000);

  it('gives the same answer twice for the same spot', () => {
    const a = solveSubgame(riverSpec(), { iterations: 120 });
    const b = solveSubgame(riverSpec(), { iterations: 120 });
    expect([...b.strategy]).toEqual([...a.strategy]);
  }, 30_000);

  /* The clairvoyance game, which has an answer known without a solver. Hero
     holds either the nuts or nothing, villain holds a hand that beats one and
     loses to the other, and the only bet available is a pot sized all-in on
     the last decision of the hand. The answer is arithmetic: villain is laid
     two to one on a call, so a third of hero's bets must be bluffs, which
     means the air bets half as often as the nuts; and villain must call half
     the time, which is what makes bluffing worth the same as giving up. */
  it('finds the clairvoyance game answer', () => {
    const board = cards(['Ah', 'Kd', '7c', '2s', '9h']);
    const nuts = comboIndex(cardIndex('As' as Card), cardIndex('Ac' as Card));
    const air = comboIndex(cardIndex('3d' as Card), cardIndex('4c' as Card));
    const bluffcatcher = comboIndex(cardIndex('Ks' as Card), cardIndex('Kc' as Card));
    const hero = emptyRange();
    hero[nuts] = 1;
    hero[air] = 1;
    const villain = emptyRange();
    villain[bluffcatcher] = 1;

    const result = solveSubgame(
      {
        ...riverSpec(),
        board,
        heroRange: hero,
        villainRange: villain,
        pot: 60,
        stack: 60,
        betSizes: [],
        raiseCap: 1,
        // Hero's check ends the hand, so this is the half street the toy game
        // is defined on rather than a street villain can bet back into.
        actedThisRound: true,
      },
      { iterations: 3000 }
    );

    const nutsPlay = frequenciesFor(result, nuts)!;
    const airPlay = frequenciesFor(result, air)!;
    const betting = (plays: typeof nutsPlay) => plays.find((f) => f.act.label === 'a')!.frequency;
    expect(betting(nutsPlay)).toBeGreaterThan(0.95);
    const bluffShare = betting(airPlay) / (betting(nutsPlay) + betting(airPlay));
    expect(bluffShare).toBeGreaterThan(0.3);
    expect(bluffShare).toBeLessThan(0.37);

    // Villain's node is the child of the root's all-in.
    const allIn = result.root.acts.findIndex((a) => a.label === 'a');
    const facing = result.root.children[allIn];
    if (facing.kind !== 'decision') throw new Error('expected a decision after the all-in');
    const villainStrategy = result.cfr.averageStrategy(facing);
    const calling = facing.acts.findIndex((a) => a.label === 'c');
    const slot = result.universe.slot[bluffcatcher];
    expect(villainStrategy[calling * result.universe.n + slot]).toBeGreaterThan(0.4);
    expect(villainStrategy[calling * result.universe.n + slot]).toBeLessThan(0.6);
  }, 30_000);

  it('folds the whole range when it cannot win a showdown', () => {
    const board = cards(['Ah', 'Ad', '7c', '2s', '9h']);
    const hero = emptyRange();
    hero[comboIndex(cardIndex('3d' as Card), cardIndex('4c' as Card))] = 1;
    const villain = emptyRange();
    villain[comboIndex(cardIndex('As' as Card), cardIndex('Ac' as Card))] = 1;
    // Hero is facing a bet of 40 into 60 with a hand that never wins.
    const result = solveSubgame(
      { ...riverSpec(), board, heroRange: hero, villainRange: villain, pot: 60, committed: [0, 40] },
      { iterations: 400 }
    );
    const frequencies = frequenciesFor(result, comboIndex(cardIndex('3d' as Card), cardIndex('4c' as Card)))!;
    const folding = frequencies.find((f) => f.act.label === 'f')!;
    expect(folding.frequency).toBeGreaterThan(0.95);
  }, 30_000);

  it('solves a turn and a flop against a depth limited leaf', () => {
    for (const board of [cards(['Ah', 'Kd', '7c', '2s']), cards(['Ah', 'Kd', '7c'])]) {
      const result = solveSubgame(
        {
          ...riverSpec(),
          board,
          heroRange: removeBlocked(rangeFromPercentiles(0, 30), board),
          villainRange: removeBlocked(rangeFromPercentiles(0, 45), board),
          pot: 40,
        },
        { budgetMs: 600 }
      );
      const exploitability = result.cfr.exploitability(fullRunoutEvaluator(result.universe, board));
      expect(exploitability).toBeGreaterThanOrEqual(0);
      expect(exploitability / 40).toBeLessThan(0.05);
    }
  }, 60_000);

  it('reports nothing for a combo neither range holds', () => {
    const result = solveSubgame(riverSpec(), { iterations: 20 });
    expect(frequenciesFor(result, comboIndex(RIVER[0], RIVER[1]))).toBeNull();
  }, 30_000);
});
