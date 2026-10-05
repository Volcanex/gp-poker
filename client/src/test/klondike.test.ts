import { describe, expect, test } from 'vitest';
import {
  bestDestination, canComplete, canMove, cardsAt, complete, draw, isWon, move, newGame,
  play, RANKS, restoreGame, SUITS,
} from '../solitaire/klondike.ts';
import type { Board, Game, TableauCard } from '../solitaire/klondike.ts';

const up = (card: string): TableauCard => ({ card, faceUp: true });
const down = (card: string): TableauCard => ({ card, faceUp: false });
const blank = (): Board => ({ stock: [], waste: [], tableau: Array.from({ length: 7 }, () => []), foundations: SUITS.map(() => []), moves: 0 });
const gameFor = (board: Board): Game => ({ board, history: [], drawCount: 1, startedAt: null, finishedAt: null });
const from = (pile: number, index = 0) => ({ kind: 'tableau' as const, pile, index });
const to = (pile: number) => ({ kind: 'tableau' as const, pile });
const foundation = (pile: number) => ({ kind: 'foundation' as const, pile });

describe('dealing', () => {
  test('deals seven piles of one to seven cards and leaves 24 in stock', () => {
    const { board } = newGame(() => 0.5);
    expect(board.tableau.map((pile) => pile.length)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(board.stock).toHaveLength(24);
    expect(board.waste).toEqual([]);
    expect(board.foundations).toEqual([[], [], [], []]);
    expect(board.tableau.every((pile) => pile.every((c, i) => c.faceUp === (i === pile.length - 1)))).toBe(true);
    const cards = [...board.stock, ...board.tableau.flat().map((c) => c.card)];
    expect(new Set(cards).size).toBe(52);
    expect(board.moves).toBe(0);
  });

  test('accepts a deterministic random source and preserves the draw setting', () => {
    expect(newGame(() => 0.3, 3)).toEqual(newGame(() => 0.3, 3));
    expect(newGame(() => 0.3, 3).drawCount).toBe(3);
    expect(newGame(() => 0.3).board).not.toEqual(newGame(() => 0.7).board);
  });
});

describe('tableau moves', () => {
  test('requires descending rank and alternating colour', () => {
    const board = blank();
    board.tableau[0] = [up('7h')];
    board.tableau[1] = [up('8s')];
    board.tableau[2] = [up('8d')];
    board.tableau[3] = [up('9c')];
    expect(canMove(board, from(0), to(1))).toBe(true);
    expect(canMove(board, from(0), to(2))).toBe(false);
    expect(canMove(board, from(0), to(3))).toBe(false);
    expect(canMove(board, from(0), to(0))).toBe(false);
    expect(canMove(board, from(0), to(99))).toBe(false);
  });

  test('moves an entire face-up run and turns over the newly exposed card', () => {
    const board = blank();
    board.tableau[0] = [down('Qs'), up('7h'), up('6c'), up('5d')];
    board.tableau[1] = [up('8s')];
    const next = move(board, from(0, 1), to(1));
    expect(next.tableau[0]).toEqual([up('Qs')]);
    expect(next.tableau[1]).toEqual([up('8s'), up('7h'), up('6c'), up('5d')]);
    expect(next.moves).toBe(1);
    expect(board.tableau[0][0].faceUp).toBe(false);
    expect(board.tableau[1]).toHaveLength(1);
  });

  test('only a king or a run starting with a king can fill an empty pile', () => {
    const board = blank();
    board.tableau[0] = [up('Kh'), up('Qc')];
    expect(canMove(board, from(0), to(1))).toBe(true);
    expect(canMove(board, from(0, 1), to(1))).toBe(false);
  });

  test('rejects hidden cards, broken runs and missing sources without changing the board', () => {
    const board = blank();
    board.tableau[0] = [down('7h')];
    board.tableau[1] = [up('8s')];
    expect(move(board, from(0), to(1))).toBe(board);
    board.tableau[0] = [up('7h'), up('5c')];
    expect(cardsAt(board, from(0))).toEqual([]);
    expect(move(board, from(0), to(1))).toBe(board);
    expect(cardsAt(board, from(0, -1))).toEqual([]);
    expect(cardsAt(board, from(99))).toEqual([]);
    expect(canMove(board, { kind: 'waste' }, to(1))).toBe(false);
  });
});

describe('foundations and automatic moves', () => {
  test('starts on ace and builds in suit, one card at a time', () => {
    const board = blank();
    board.waste = ['Ah'];
    expect(canMove(board, { kind: 'waste' }, foundation(1))).toBe(true);
    expect(canMove(board, { kind: 'waste' }, foundation(0))).toBe(false);
    board.foundations[1] = ['Ah'];
    board.waste = ['2h'];
    expect(canMove(board, { kind: 'waste' }, foundation(1))).toBe(true);
    board.waste = ['3h'];
    expect(canMove(board, { kind: 'waste' }, foundation(1))).toBe(false);
    board.tableau[0] = [up('2h'), up('As')];
    expect(canMove(board, from(0), foundation(1))).toBe(false);
  });

  test('allows the top foundation card back onto a legal tableau', () => {
    const board = blank();
    board.foundations[1] = ['Ah', '2h'];
    board.tableau[0] = [up('3c')];
    const next = move(board, foundation(1), to(0));
    expect(next.foundations[1]).toEqual(['Ah']);
    expect(next.tableau[0]).toEqual([up('3c'), up('2h')]);
  });

  test('prefers the foundation, supports foundation-only taps and ignores covered waste cards', () => {
    const board = blank();
    board.waste = ['2h', 'Ah'];
    board.tableau[0] = [up('2c')];
    expect(bestDestination(board, { kind: 'waste' })).toEqual(foundation(1));
    let game = play(gameFor(board), { type: 'auto', card: 'Ah' }, 1000);
    expect(game.board.foundations[1]).toEqual(['Ah']);
    expect(play(gameFor(board), { type: 'auto', card: '2h' }, 1000).board).toBe(board);
    game.board.tableau[1] = [up('7h')];
    game.board.tableau[2] = [up('8s')];
    expect(bestDestination(game.board, from(1), true)).toBeNull();
    expect(bestDestination(game.board, from(1))).toEqual(to(2));
  });

  test('does not automatically shuffle an entire king pile between empty columns', () => {
    const board = blank();
    board.tableau[0] = [up('Kh'), up('Qc')];
    expect(bestDestination(board, from(0))).toBeNull();
    expect(canMove(board, from(0), to(1))).toBe(true);
  });
});

describe('stock', () => {
  test('draws one or three, with only the top waste card playable', () => {
    const board = blank();
    board.stock = ['Ah', '2s', '3h', '4s'];
    const one = draw(board, 1);
    const three = draw(board, 3);
    expect(one.waste).toEqual(['4s']);
    expect(three.waste).toEqual(['4s', '3h', '2s']);
    expect(cardsAt(three, { kind: 'waste' })).toEqual(['2s']);
    expect(draw(three, 3).waste).toEqual(['4s', '3h', '2s', 'Ah']);
    expect(board.stock).toHaveLength(4);
  });

  test('redeals indefinitely in the original order and counts each action', () => {
    const initial = blank();
    initial.stock = ['Ah', '2s', '3h', '4s'];
    let board = initial;
    for (let pass = 0; pass < 20; pass++) {
      board = draw(draw(board, 3), 3);
      expect(board.waste).toEqual(['4s', '3h', '2s', 'Ah']);
      board = draw(board, 3);
      expect(board.stock).toEqual(initial.stock);
      expect(board.waste).toEqual([]);
    }
    expect(board.moves).toBe(60);
    expect(draw(blank(), 1).moves).toBe(0);
  });

  test('changing the draw count leaves the deal and counter alone', () => {
    const game = newGame(() => 0.5);
    const next = play(game, { type: 'drawCount', count: 3 }, 1000);
    expect(next.board).toBe(game.board);
    expect(next.history).toEqual([]);
    expect(play(next, { type: 'draw' }, 1000).board.waste).toHaveLength(3);
  });
});

describe('completion and undo', () => {
  test('wins only with all four foundations complete', () => {
    const board = blank();
    board.foundations = SUITS.map((suit) => [...RANKS].map((r) => `${r}${suit}`));
    expect(isWon(board)).toBe(true);
    board.foundations[0].pop();
    expect(isWon(board)).toBe(false);
  });

  test('completes an exposed tableau, including stock and waste, as one undoable action', () => {
    const game = newGame(() => 0.5);
    expect(canComplete(game.board)).toBe(false);
    expect(complete(game.board)).toBe(game.board);
    // A legal exposed tableau with the remaining cards still in the stock.
    game.board.stock.push(...game.board.tableau.flat().map((c) => c.card));
    game.board.tableau = Array.from({ length: 7 }, () => []);
    game.board.tableau[0] = [up(game.board.stock.pop()!)];
    expect(canComplete(game.board)).toBe(true);
    const won = play(game, { type: 'complete' }, 5000);
    expect(isWon(won.board)).toBe(true);
    expect(won.board.stock).toEqual([]);
    expect(won.board.moves).toBe(52);
    expect(won.finishedAt).toBe(5000);
    expect(won.history).toHaveLength(1);
    expect(play(won, { type: 'undo' }, 6000).board).toEqual(game.board);
    expect(canComplete(won.board)).toBe(false);
  });

  test('undo restores cards, flips, moves and stock redeals without rewinding the timer', () => {
    const board = blank();
    board.tableau[0] = [down('Qs'), up('7h')];
    board.tableau[1] = [up('8s')];
    const game = gameFor(board);
    const moved = play(game, { type: 'move', from: from(0, 1), to: to(1) }, 1000);
    const undone = play(moved, { type: 'undo' }, 2000);
    expect(undone.board).toBe(board);
    expect(undone.startedAt).toBe(1000);
    expect(undone.history).toEqual([]);
    expect(play(undone, { type: 'undo' }, 3000)).toBe(undone);
    const dealt = newGame(() => 0.5);
    let drawn = dealt;
    for (let i = 0; i < 24; i++) drawn = play(drawn, { type: 'draw' }, 1000);
    const redealt = play(drawn, { type: 'draw' }, 2000);
    expect(play(redealt, { type: 'undo' }, 3000).board).toEqual(drawn.board);
    for (let i = 0; i < 25; i++) drawn = play(drawn, { type: 'undo' }, 4000);
    expect(drawn.board).toEqual(dealt.board);
  });

  test('invalid moves do not start the timer or add history', () => {
    const game = newGame(() => 0.5);
    expect(play(game, { type: 'move', from: from(6), to: to(0) }, 1000)).toBe(game);
    expect(game.startedAt).toBeNull();
  });
});

describe('saved games', () => {
  test('round-trips the deal, settings, timer and undo history', () => {
    let game = newGame(() => 0.5, 3);
    game = play(game, { type: 'draw' }, 1000);
    game = play(game, { type: 'draw' }, 2000);
    const restored = restoreGame(JSON.stringify(game));
    expect(restored).toEqual(game);
    expect(play(restored!, { type: 'undo' }, 3000).board).toEqual(game.history[1]);
  });

  test('rejects malformed data, missing and duplicate cards, broken piles and corrupt history', () => {
    const game = newGame(() => 0.5);
    expect(restoreGame('bad json')).toBeNull();
    expect(restoreGame('null')).toBeNull();
    expect(restoreGame('{}')).toBeNull();
    const bad = structuredClone(game);
    bad.board.stock[0] = bad.board.stock[1];
    expect(restoreGame(JSON.stringify(bad))).toBeNull();
    bad.board.stock = game.board.stock.slice(1);
    expect(restoreGame(JSON.stringify(bad))).toBeNull();
    bad.board = structuredClone(game.board);
    bad.board.tableau[0][0].faceUp = false;
    expect(restoreGame(JSON.stringify(bad))).toBeNull();
    bad.board = structuredClone(game.board);
    bad.history = [blank()];
    expect(restoreGame(JSON.stringify(bad))).toBeNull();
    bad.history = [];
    bad.finishedAt = 1000;
    expect(restoreGame(JSON.stringify(bad))).toBeNull();
  });
});
