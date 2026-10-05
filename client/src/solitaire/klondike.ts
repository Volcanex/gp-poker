import type { Card } from '@opentable/protocol';

export const RANKS = 'A23456789TJQK';
export const SUITS = ['s', 'h', 'd', 'c'] as const;
export type DrawCount = 1 | 3;
export interface TableauCard { card: Card; faceUp: boolean }
export interface Board {
  stock: Card[];
  waste: Card[];
  tableau: TableauCard[][];
  foundations: Card[][];
  moves: number;
}
export interface Game {
  board: Board;
  history: Board[];
  drawCount: DrawCount;
  startedAt: number | null;
  finishedAt: number | null;
}
export type Source = { kind: 'tableau'; pile: number; index: number }
  | { kind: 'waste' }
  | { kind: 'foundation'; pile: number };
export type Destination = { kind: 'tableau' | 'foundation'; pile: number };
export type Action = { type: 'draw' | 'undo' | 'complete' }
  | { type: 'move'; from: Source; to: Destination }
  | { type: 'auto'; card: Card; foundationOnly?: boolean }
  | { type: 'drawCount'; count: DrawCount };

const rank = (card: Card) => RANKS.indexOf(card[0]);
const red = (card: Card) => card[1] === 'h' || card[1] === 'd';
const descends = (lower: Card, upper: Card) => rank(lower) === rank(upper) + 1 && red(lower) !== red(upper);
const top = <T,>(pile: T[]) => pile[pile.length - 1];

export function newGame(random = Math.random, drawCount: DrawCount = 1): Game {
  const deck: Card[] = SUITS.flatMap((suit) => [...RANKS].map((r) => `${r}${suit}`));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const tableau: TableauCard[][] = Array.from({ length: 7 }, () => []);
  for (let row = 0; row < 7; row++) {
    for (let pile = row; pile < 7; pile++) {
      tableau[pile].push({ card: deck.pop()!, faceUp: pile === row });
    }
  }
  return {
    board: { stock: deck, waste: [], tableau, foundations: SUITS.map(() => []), moves: 0 },
    history: [], drawCount, startedAt: null, finishedAt: null,
  };
}

export function cardsAt(board: Board, from: Source): Card[] {
  if (from.kind === 'tableau') {
    const pile = board.tableau[from.pile];
    if (!pile || from.index < 0 || !pile[from.index]?.faceUp) return [];
    const run = pile.slice(from.index);
    if (!run.every((c, i) => c.faceUp && (i === 0 || descends(run[i - 1].card, c.card)))) return [];
    return run.map((c) => c.card);
  }
  const pile = from.kind === 'waste' ? board.waste : board.foundations[from.pile];
  return pile?.length ? [top(pile)] : [];
}

export function canMove(board: Board, from: Source, to: Destination): boolean {
  const cards = cardsAt(board, from);
  if (!cards.length || (from.kind === to.kind && from.pile === to.pile)) return false;
  if (to.kind === 'foundation') {
    const pile = board.foundations[to.pile];
    return !!pile && cards.length === 1 && cards[0][1] === SUITS[to.pile] && rank(cards[0]) === pile.length;
  }
  const pile = board.tableau[to.pile];
  if (!pile) return false;
  return pile.length ? top(pile).faceUp && descends(top(pile).card, cards[0]) : rank(cards[0]) === 12;
}

function copyBoard(board: Board): Board {
  return {
    ...board, stock: [...board.stock], waste: [...board.waste],
    tableau: board.tableau.map((pile) => pile.map((c) => ({ ...c }))),
    foundations: board.foundations.map((pile) => [...pile]),
  };
}

export function move(board: Board, from: Source, to: Destination): Board {
  if (!canMove(board, from, to)) return board;
  const cards = cardsAt(board, from);
  const next = copyBoard(board);
  if (from.kind === 'tableau') {
    const pile = next.tableau[from.pile];
    pile.splice(from.index);
    if (pile.length) top(pile).faceUp = true;
  } else if (from.kind === 'waste') next.waste.pop();
  else next.foundations[from.pile].pop();
  if (to.kind === 'foundation') next.foundations[to.pile].push(...cards);
  else next.tableau[to.pile].push(...cards.map((card) => ({ card, faceUp: true })));
  next.moves++;
  return next;
}

export function draw(board: Board, count: DrawCount): Board {
  if (!board.stock.length && !board.waste.length) return board;
  const next = copyBoard(board);
  if (next.stock.length) {
    for (let i = 0; i < count && next.stock.length; i++) next.waste.push(next.stock.pop()!);
  } else {
    next.stock = next.waste.reverse();
    next.waste = [];
  }
  next.moves++;
  return next;
}

export function findSource(board: Board, card: Card): Source | null {
  if (top(board.waste) === card) return { kind: 'waste' };
  for (let pile = 0; pile < 7; pile++) {
    const index = board.tableau[pile].findIndex((c) => c.card === card && c.faceUp);
    if (index >= 0) return { kind: 'tableau', pile, index };
  }
  for (let pile = 0; pile < 4; pile++) {
    if (top(board.foundations[pile]) === card) return { kind: 'foundation', pile };
  }
  return null;
}

export function bestDestination(board: Board, from: Source, foundationOnly = false): Destination | null {
  for (let pile = 0; pile < 4; pile++) {
    const to: Destination = { kind: 'foundation', pile };
    if (canMove(board, from, to)) return to;
  }
  if (foundationOnly) return null;
  const destinations = board.tableau.map((_, pile): Destination => ({ kind: 'tableau', pile }))
    .filter((to) => canMove(board, from, to));
  // A king already at the bottom of a pile gains nothing by swapping empty piles.
  if (from.kind === 'tableau' && from.index === 0) {
    return destinations.find((to) => board.tableau[to.pile].length > 0) ?? null;
  }
  return destinations.sort((a, b) => {
    const hidden = (pile: number) => board.tableau[pile].filter((c) => !c.faceUp).length;
    return hidden(b.pile) - hidden(a.pile) || board.tableau[b.pile].length - board.tableau[a.pile].length;
  })[0] ?? null;
}

export function isWon(board: Board): boolean {
  return board.foundations.every((pile) => pile.length === 13);
}

export function canComplete(board: Board): boolean {
  return !isWon(board) && board.tableau.every((pile) => pile.every((c) => c.faceUp));
}

export function complete(board: Board): Board {
  if (!canComplete(board)) return board;
  const next = copyBoard(board);
  const remaining = [...next.stock, ...next.waste, ...next.tableau.flatMap((pile) => pile.map((c) => c.card))];
  remaining.sort((a, b) => rank(a) - rank(b));
  for (const card of remaining) {
    const pile = next.foundations[SUITS.indexOf(card[1] as typeof SUITS[number])];
    if (!pile || rank(card) !== pile.length) return board;
    pile.push(card);
  }
  next.stock = [];
  next.waste = [];
  next.tableau = next.tableau.map(() => []);
  next.moves += remaining.length;
  return next;
}

export function play(game: Game, action: Action, now: number): Game {
  if (action.type === 'drawCount') return { ...game, drawCount: action.count };
  if (action.type === 'undo') {
    if (!game.history.length) return game;
    return { ...game, board: top(game.history), history: game.history.slice(0, -1), finishedAt: null };
  }
  if (isWon(game.board)) return game;
  let board = game.board;
  if (action.type === 'draw') board = draw(board, game.drawCount);
  if (action.type === 'complete') board = complete(board);
  if (action.type === 'move') board = move(board, action.from, action.to);
  if (action.type === 'auto') {
    const from = findSource(board, action.card);
    const to = from && bestDestination(board, from, action.foundationOnly);
    if (from && to) board = move(board, from, to);
  }
  if (board === game.board) return game;
  return {
    ...game, board, history: [...game.history, game.board], startedAt: game.startedAt ?? now,
    finishedAt: isWon(board) ? now : null,
  };
}

function validBoard(value: unknown): value is Board {
  if (!value || typeof value !== 'object') return false;
  const b = value as Board;
  const validCard = (c: unknown): c is Card => typeof c === 'string' && /^[A23456789TJQK][shdc]$/.test(c);
  if (!Number.isSafeInteger(b.moves) || b.moves < 0 || !Array.isArray(b.stock) || !Array.isArray(b.waste)
    || !b.stock.every(validCard) || !b.waste.every(validCard)
    || !Array.isArray(b.tableau) || b.tableau.length !== 7
    || !Array.isArray(b.foundations) || b.foundations.length !== 4) return false;
  if (!b.foundations.every((pile, i) => Array.isArray(pile)
    && pile.every((c, j) => validCard(c) && c[1] === SUITS[i] && rank(c) === j))) return false;
  if (!b.tableau.every((pile) => Array.isArray(pile) && (!pile.length || top(pile)?.faceUp === true)
    && pile.every((c, i) => c && validCard(c.card) && typeof c.faceUp === 'boolean'
      && (i === 0 || !pile[i - 1].faceUp || (c.faceUp && descends(pile[i - 1].card, c.card)))))) return false;
  const cards = [...b.stock, ...b.waste, ...b.foundations.flat(), ...b.tableau.flatMap((pile) => pile.map((c) => c.card))];
  return cards.length === 52 && new Set(cards).size === 52;
}

export function restoreGame(raw: string): Game | null {
  try {
    const g = JSON.parse(raw) as Game;
    const timestamp = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0);
    if (!g || !validBoard(g.board) || !Array.isArray(g.history) || !g.history.every(validBoard)
      || (g.drawCount !== 1 && g.drawCount !== 3) || !timestamp(g.startedAt) || !timestamp(g.finishedAt)
      || (g.finishedAt !== null && (g.startedAt === null || g.finishedAt < g.startedAt))
      || isWon(g.board) !== (g.finishedAt !== null) || (g.board.moves > 0 && g.startedAt === null)) return null;
    return g;
  } catch {
    return null;
  }
}
