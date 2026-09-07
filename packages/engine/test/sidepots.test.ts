import { describe, expect, it } from 'vitest';
import { apply, createHandWithDeck } from '../src/index.js';
import type { Action, Card, HandConfig, HandState } from '../src/index.js';

const RANKS = '23456789TJQKA';
const SUITS = ['c', 'd', 'h', 's'];

function fullDeck(): Card[] {
  const d: Card[] = [];
  for (const s of SUITS) for (const r of RANKS) d.push(r + s);
  return d;
}

/* Places the given hole cards (dealt in seat order left of the button) and
   board first, then fills the rest of the 52-card deck arbitrarily. Lets
   tests pin exact hands without hand-computing the deal order. */
function buildDeck(config: HandConfig, holes: Record<number, [Card, Card]>, board: Card[]): Card[] {
  const n = config.seats.length;
  const order: number[] = [];
  for (let i = 0; i < n; i++) order.push((config.button + 1 + i) % n);
  const used: Card[] = [];
  for (const idx of order) used.push(holes[idx][0]);
  for (const idx of order) used.push(holes[idx][1]);
  used.push(...board);
  const usedSet = new Set(used);
  const rest = fullDeck().filter((c) => !usedSet.has(c));
  return [...used, ...rest];
}

function stacksOf(s: number[]): HandConfig['seats'] {
  return s.map((stack, i) => ({ id: `p${i}`, stack }));
}

function play(state: HandState, steps: [number, Action][]): HandState {
  let cur = state;
  for (const [seat, action] of steps) cur = apply(cur, seat, action);
  return cur;
}

function totalStacks(state: HandState): number {
  return state.seats.reduce((sum, s) => sum + s.stack, 0);
}

/* Reusable card kits. */
const WIN_BOARD: Card[] = ['2h', '7c', '9d', 'Jc', '4s'];
const WIN_HOLE: [Card, Card] = ['Ah', 'Ac']; // pair of aces: beats any unpaired hand below
const LOSE_HOLE: [Card, Card] = ['3d', '5h']; // high card jack

const TIE_BOARD: Card[] = ['As', 'Ac', '7d', '4h', '2s'];
const TIE_HOLE_A: [Card, Card] = ['2c', '3d']; // two pair, A/A + 2/2, kicker 7
const TIE_HOLE_B: [Card, Card] = ['2d', '3h']; // exact same value
const TIE_HOLE_C: [Card, Card] = ['2h', '6c']; // also exact same value
const TIE_LOSE_HOLE: [Card, Card] = ['6c', '8d']; // one pair only (no rank-2 to pair)

const QUAD_BOARD: Card[] = ['Kd', 'Ks', '2h', '3c', '4d'];
const QUAD_HOLE: [Card, Card] = ['Kh', 'Kc']; // four kings
const FULLHOUSE_HOLE: [Card, Card] = ['2c', '2d']; // twos full of kings
const STRAIGHT_HOLE: [Card, Card] = ['5s', '6d']; // 2-3-4-5-6

describe('side pots and showdown payouts', () => {
  it('1. three-way with two different all-in sizes', () => {
    const config: HandConfig = {
      seats: stacksOf([50, 300, 1000]),
      button: 0,
      sb: 1,
      bb: 2,
      seed: 'x',
    };
    const deck = buildDeck(config, { 0: QUAD_HOLE, 1: FULLHOUSE_HOLE, 2: STRAIGHT_HOLE }, QUAD_BOARD);
    let state = createHandWithDeck(config, deck);
    expect(state.toAct).toBe(0);
    state = play(state, [
      [0, { a: 'a' }],
      [1, { a: 'c' }],
      [2, { a: 'a' }],
      [1, { a: 'c' }],
    ]);
    expect(state.street).toBe('done');
    expect(state.result?.pots).toEqual([
      { amount: 150, eligible: [0, 1, 2] },
      { amount: 500, eligible: [1, 2] },
      { amount: 700, eligible: [2] },
    ]);
    expect(state.result?.awards).toEqual([
      { seat: 0, amount: 150, hand: 'Four of a Kind' },
      { seat: 1, amount: 500, hand: 'Full House' },
      { seat: 2, amount: 700, hand: 'Straight' },
    ]);
    expect(state.seats.map((s) => s.stack)).toEqual([150, 500, 700]);
    expect(totalStacks(state)).toBe(1350);
  });

  it('2. four-way with three side pots', () => {
    const config: HandConfig = { seats: stacksOf([1000, 100, 200, 300]), button: 0, sb: 1, bb: 2, seed: 'x' };
    const deck = buildDeck(
      config,
      { 0: ['7h', '7s'], 1: QUAD_HOLE, 2: STRAIGHT_HOLE, 3: FULLHOUSE_HOLE },
      QUAD_BOARD,
    );
    let state = createHandWithDeck(config, deck);
    expect(state.toAct).toBe(3); // utg
    state = play(state, [
      [3, { a: 'a' }],
      [0, { a: 'a' }],
      [1, { a: 'a' }],
      [2, { a: 'a' }],
    ]);
    expect(state.street).toBe('done');
    expect(state.result?.pots).toHaveLength(4);
    expect(state.seats.map((s) => s.stack)).toEqual([700, 400, 0, 500]);
    expect(totalStacks(state)).toBe(1600);
  });

  it('3. a short blind all-in (bb posts less than a full bb), heads-up', () => {
    const config: HandConfig = { seats: stacksOf([100, 3]), button: 0, sb: 5, bb: 10, seed: 'x' };
    const deck = buildDeck(config, { 0: WIN_HOLE, 1: LOSE_HOLE }, WIN_BOARD);
    let state = createHandWithDeck(config, deck);
    expect(state.seats[1].bet).toBe(3);
    expect(state.seats[1].allin).toBe(true);
    expect(state.toAct).toBe(0); // sb still has a decision: bb's short all-in is below their own bet
    state = play(state, [
      [0, { a: 'x' }],
      [0, { a: 'x' }],
      [0, { a: 'x' }],
      [0, { a: 'x' }],
    ]);
    expect(state.street).toBe('done');
    expect(state.result?.pots).toEqual([
      { amount: 6, eligible: [0, 1] },
      { amount: 2, eligible: [0] },
    ]);
    expect(state.seats.map((s) => s.stack)).toEqual([103, 0]);
  });

  it('4. a short blind all-in (sb posts less than a full sb), 3-handed', () => {
    const config: HandConfig = { seats: stacksOf([500, 4, 200]), button: 0, sb: 10, bb: 20, seed: 'x' };
    const deck = buildDeck(config, { 0: FULLHOUSE_HOLE, 1: QUAD_HOLE, 2: STRAIGHT_HOLE }, QUAD_BOARD);
    let state = createHandWithDeck(config, deck);
    expect(state.seats[1].bet).toBe(4);
    expect(state.seats[1].allin).toBe(true);
    expect(state.toAct).toBe(0); // button acts first preflop, 3-handed
    state = play(state, [
      [0, { a: 'c' }],
      [2, { a: 'x' }],
      [2, { a: 'x' }],
      [0, { a: 'x' }],
      [2, { a: 'x' }],
      [0, { a: 'x' }],
      [2, { a: 'x' }],
      [0, { a: 'x' }],
    ]);
    expect(state.street).toBe('done');
    expect(state.result?.pots).toEqual([
      { amount: 12, eligible: [0, 1, 2] },
      { amount: 32, eligible: [0, 2] },
    ]);
    expect(state.seats.map((s) => s.stack)).toEqual([512, 12, 180]);
  });

  it('5. an all-in call for less', () => {
    const config: HandConfig = { seats: stacksOf([1000, 50]), button: 0, sb: 1, bb: 2, seed: 'x' };
    const deck = buildDeck(config, { 0: LOSE_HOLE, 1: WIN_HOLE }, WIN_BOARD);
    let state = createHandWithDeck(config, deck);
    state = play(state, [
      [0, { a: 'a' }],
      [1, { a: 'c' }],
    ]);
    expect(state.seats[1].allin).toBe(true);
    expect(state.seats[1].committed).toBe(50);
    expect(state.street).toBe('done');
    expect(state.result?.pots).toEqual([
      { amount: 100, eligible: [0, 1] },
      { amount: 950, eligible: [0] },
    ]);
    expect(state.seats.map((s) => s.stack)).toEqual([950, 100]);
  });

  it('6. an all-in below the min raise does not reopen action, and payouts follow the actual side pots', () => {
    const config: HandConfig = { seats: stacksOf([1000, 1000, 17]), button: 0, sb: 1, bb: 2, seed: 'x' };
    const deck = buildDeck(config, { 0: ['6c', '8d'], 1: LOSE_HOLE, 2: WIN_HOLE }, WIN_BOARD);
    let state = createHandWithDeck(config, deck);
    state = play(state, [
      [0, { a: 'c' }],
      [1, { a: 'c' }],
      [2, { a: 'x' }],
      [1, { a: 'b', v: 10 }],
      [2, { a: 'a' }],
      [0, { a: 'f' }],
    ]);
    expect(state.street).toBe('turn'); // closed immediately: the short all-in did not reopen for seat 1
    state = play(state, [
      [1, { a: 'x' }],
      [1, { a: 'x' }],
    ]);
    expect(state.street).toBe('done');
    expect(state.result?.pots).toEqual([
      { amount: 26, eligible: [1, 2] },
      { amount: 5, eligible: [2] },
    ]);
    expect(state.seats.map((s) => s.stack)).toEqual([998, 988, 31]);
    expect(totalStacks(state)).toBe(2017);
  });

  it('7. split main pot with an uncontested side pot', () => {
    const config: HandConfig = { seats: stacksOf([50, 50, 500]), button: 0, sb: 1, bb: 2, seed: 'x' };
    const deck = buildDeck(config, { 0: QUAD_HOLE, 1: TIE_HOLE_A, 2: ['6c', '8d'] }, TIE_BOARD);
    let state = createHandWithDeck(config, deck);
    state = play(state, [
      [0, { a: 'a' }],
      [1, { a: 'a' }],
      [2, { a: 'a' }],
    ]);
    expect(state.street).toBe('done');
    expect(state.result?.pots).toEqual([
      { amount: 150, eligible: [0, 1, 2] },
      { amount: 450, eligible: [2] },
    ]);
    expect(state.seats.map((s) => s.stack)).toEqual([150, 0, 450]);
  });

  it('8. odd chip allocation on a three-way tie', () => {
    const config: HandConfig = { seats: stacksOf([25, 25, 25]), button: 0, sb: 1, bb: 2, seed: 'x' };
    const deck = buildDeck(config, { 0: TIE_HOLE_A, 1: TIE_HOLE_B, 2: TIE_LOSE_HOLE }, TIE_BOARD);
    let state = createHandWithDeck(config, deck);
    state = play(state, [
      [0, { a: 'a' }],
      [1, { a: 'a' }],
      [2, { a: 'a' }],
    ]);
    expect(state.street).toBe('done');
    expect(state.result?.pots).toEqual([{ amount: 75, eligible: [0, 1, 2] }]);
    // seat 1 is first left of the button among the tied winners, gets the odd chip
    expect(state.result?.awards).toEqual([
      { seat: 0, amount: 37, hand: 'Two Pair' },
      { seat: 1, amount: 38, hand: 'Two Pair' },
    ]);
    expect(state.seats.map((s) => s.stack)).toEqual([37, 38, 0]);
  });

  it('9. everyone folds to a short all-in', () => {
    const config: HandConfig = { seats: stacksOf([5, 1000, 1000]), button: 0, sb: 1, bb: 2, seed: 'x' };
    const deck = buildDeck(config, { 0: WIN_HOLE, 1: LOSE_HOLE, 2: LOSE_HOLE.slice().reverse() as [Card, Card] }, WIN_BOARD);
    let state = createHandWithDeck(config, deck);
    state = play(state, [
      [0, { a: 'a' }],
      [1, { a: 'f' }],
      [2, { a: 'f' }],
    ]);
    expect(state.street).toBe('done');
    expect(state.result?.shown).toEqual({});
    expect(state.result?.awards).toEqual([{ seat: 0, amount: 8 }]);
    expect(state.seats.map((s) => s.stack)).toEqual([8, 999, 998]);
  });

  it('10. a folded players money stays in the pot for the eventual winner', () => {
    const config: HandConfig = { seats: stacksOf([500, 500, 500]), button: 0, sb: 1, bb: 2, seed: 'x' };
    const deck = buildDeck(config, { 0: ['6d', '8h'], 1: WIN_HOLE, 2: LOSE_HOLE }, WIN_BOARD);
    let state = createHandWithDeck(config, deck);
    state = play(state, [
      [0, { a: 'c' }],
      [1, { a: 'c' }],
      [2, { a: 'x' }],
      [1, { a: 'b', v: 20 }],
      [2, { a: 'c' }],
      [0, { a: 'f' }],
    ]);
    expect(state.street).toBe('turn');
    state = play(state, [
      [1, { a: 'x' }],
      [2, { a: 'x' }],
      [1, { a: 'x' }],
      [2, { a: 'x' }],
    ]);
    expect(state.street).toBe('done');
    expect(state.result?.pots).toEqual([{ amount: 46, eligible: [1, 2] }]);
    expect(state.seats.map((s) => s.stack)).toEqual([498, 524, 478]);
    expect(totalStacks(state)).toBe(1500);
  });

  it('11. heads-up bust', () => {
    const config: HandConfig = { seats: stacksOf([200, 200]), button: 0, sb: 1, bb: 2, seed: 'x' };
    const deck = buildDeck(config, { 0: WIN_HOLE, 1: LOSE_HOLE }, WIN_BOARD);
    let state = createHandWithDeck(config, deck);
    state = play(state, [
      [0, { a: 'a' }],
      [1, { a: 'a' }],
    ]);
    expect(state.street).toBe('done');
    expect(state.seats.map((s) => s.stack)).toEqual([400, 0]);
  });

  it('12. three-way all same all-in size, single pot, no side pots', () => {
    const config: HandConfig = { seats: stacksOf([40, 40, 40]), button: 0, sb: 1, bb: 2, seed: 'x' };
    const deck = buildDeck(config, { 0: QUAD_HOLE, 1: FULLHOUSE_HOLE, 2: STRAIGHT_HOLE }, QUAD_BOARD);
    let state = createHandWithDeck(config, deck);
    state = play(state, [
      [0, { a: 'a' }],
      [1, { a: 'a' }],
      [2, { a: 'a' }],
    ]);
    expect(state.result?.pots).toEqual([{ amount: 120, eligible: [0, 1, 2] }]);
    expect(state.seats.map((s) => s.stack)).toEqual([120, 0, 0]);
  });

  it('13. four-way: two players tie for a side pot, a different winner takes the main pot', () => {
    const config: HandConfig = { seats: stacksOf([30, 200, 200, 200]), button: 0, sb: 1, bb: 2, seed: 'x' };
    const deck = buildDeck(
      config,
      { 0: QUAD_HOLE, 1: ['2c', '7h'], 2: ['2d', '7s'], 3: ['8c', '9d'] },
      QUAD_BOARD,
    );
    let state = createHandWithDeck(config, deck);
    expect(state.toAct).toBe(3);
    state = play(state, [
      [3, { a: 'a' }],
      [0, { a: 'a' }],
      [1, { a: 'a' }],
      [2, { a: 'a' }],
    ]);
    expect(state.result?.pots).toEqual([
      { amount: 120, eligible: [0, 1, 2, 3] },
      { amount: 510, eligible: [1, 2, 3] },
    ]);
    expect(state.seats.map((s) => s.stack)).toEqual([120, 255, 255, 0]);
    expect(totalStacks(state)).toBe(630);
  });

  it('14. five-way with multiple sequential all-ins forming several side pots', () => {
    const config: HandConfig = { seats: stacksOf([10, 20, 30, 40, 1000]), button: 0, sb: 1, bb: 2, seed: 'x' };
    const deck = buildDeck(
      config,
      { 0: ['5c', '6d'], 1: ['7h', '8s'], 2: ['9h', 'Th'], 3: ['Jc', 'Qd'], 4: QUAD_HOLE },
      QUAD_BOARD,
    );
    let state = createHandWithDeck(config, deck);
    expect(state.toAct).toBe(3);
    state = play(state, [
      [3, { a: 'a' }],
      [4, { a: 'a' }],
      [0, { a: 'a' }],
      [1, { a: 'a' }],
      [2, { a: 'a' }],
    ]);
    expect(state.result?.pots).toHaveLength(5);
    expect(state.seats.map((s) => s.stack)).toEqual([0, 0, 0, 0, 1100]);
  });

  it('15. a side pot with exactly two eligible players tying, split evenly', () => {
    const config: HandConfig = { seats: stacksOf([20, 100, 100]), button: 0, sb: 1, bb: 2, seed: 'x' };
    const deck = buildDeck(config, { 0: QUAD_HOLE, 1: ['2c', '7h'], 2: ['2d', '7s'] }, QUAD_BOARD);
    let state = createHandWithDeck(config, deck);
    state = play(state, [
      [0, { a: 'a' }],
      [1, { a: 'a' }],
      [2, { a: 'a' }],
    ]);
    expect(state.result?.pots).toEqual([
      { amount: 60, eligible: [0, 1, 2] },
      { amount: 160, eligible: [1, 2] },
    ]);
    expect(state.seats.map((s) => s.stack)).toEqual([60, 80, 80]);
  });

  it('16. an all-in for less than the small blind', () => {
    const config: HandConfig = { seats: stacksOf([1, 500]), button: 0, sb: 10, bb: 20, seed: 'x' };
    const deck = buildDeck(config, { 0: WIN_HOLE, 1: LOSE_HOLE }, WIN_BOARD);
    let state = createHandWithDeck(config, deck);
    expect(state.seats[0].allin).toBe(true);
    expect(state.seats[0].bet).toBe(1);
    expect(state.toAct).toBe(1);
    state = play(state, [
      [1, { a: 'x' }],
      [1, { a: 'x' }],
      [1, { a: 'x' }],
      [1, { a: 'x' }],
    ]);
    expect(state.street).toBe('done');
    expect(state.result?.pots).toEqual([
      { amount: 2, eligible: [0, 1] },
      { amount: 19, eligible: [1] },
    ]);
    expect(state.seats.map((s) => s.stack)).toEqual([2, 499]);
    expect(totalStacks(state)).toBe(501);
  });

  it('17. an uncalled overbet is returned: the winner is credited only for what was actually matched', () => {
    const config: HandConfig = { seats: stacksOf([1000, 50]), button: 0, sb: 1, bb: 2, seed: 'x' };
    const deck = buildDeck(config, { 0: WIN_HOLE, 1: LOSE_HOLE }, WIN_BOARD);
    let state = createHandWithDeck(config, deck);
    state = play(state, [
      [0, { a: 'c' }],
      [1, { a: 'x' }],
      [1, { a: 'x' }],
      [0, { a: 'b', v: 500 }],
      [1, { a: 'f' }],
    ]);
    expect(state.street).toBe('done');
    expect(state.result?.awards).toEqual([{ seat: 0, amount: 504 }]);
    expect(state.seats.map((s) => s.stack)).toEqual([1002, 48]);
    expect(totalStacks(state)).toBe(1050);
  });

  it('18. all-in on the flop auto-runs the turn and river to showdown', () => {
    const config: HandConfig = { seats: stacksOf([100, 100]), button: 0, sb: 1, bb: 2, seed: 'x' };
    const deck = buildDeck(config, { 0: WIN_HOLE, 1: LOSE_HOLE }, WIN_BOARD);
    let state = createHandWithDeck(config, deck);
    state = play(state, [
      [0, { a: 'c' }],
      [1, { a: 'x' }],
      [1, { a: 'a' }],
      [0, { a: 'c' }],
    ]);
    expect(state.street).toBe('done');
    expect(state.board).toHaveLength(5);
    expect(state.seats.map((s) => s.stack)).toEqual([200, 0]);
  });

  it('19. a folded player would have had the best hand, but is correctly excluded', () => {
    const config: HandConfig = { seats: stacksOf([100, 100, 100]), button: 0, sb: 1, bb: 2, seed: 'x' };
    const deck = buildDeck(config, { 0: QUAD_HOLE, 1: FULLHOUSE_HOLE, 2: STRAIGHT_HOLE }, QUAD_BOARD);
    let state = createHandWithDeck(config, deck);
    expect(state.toAct).toBe(0);
    state = play(state, [
      [0, { a: 'f' }],
      [1, { a: 'c' }],
      [2, { a: 'x' }],
      [1, { a: 'x' }],
      [2, { a: 'x' }],
      [1, { a: 'x' }],
      [2, { a: 'x' }],
      [1, { a: 'x' }],
      [2, { a: 'x' }],
    ]);
    expect(state.street).toBe('done');
    expect(state.result?.shown).not.toHaveProperty('0');
    expect(state.result?.pots).toEqual([{ amount: 4, eligible: [1, 2] }]);
    expect(state.seats.map((s) => s.stack)).toEqual([100, 102, 98]);
    expect(totalStacks(state)).toBe(300);
  });

  it('20. a normal raised pot goes to showdown without anyone busting', () => {
    const config: HandConfig = { seats: stacksOf([300, 300]), button: 0, sb: 1, bb: 2, seed: 'x' };
    const deck = buildDeck(config, { 0: WIN_HOLE, 1: LOSE_HOLE }, WIN_BOARD);
    let state = createHandWithDeck(config, deck);
    state = play(state, [
      [0, { a: 'r', v: 10 }],
      [1, { a: 'c' }],
      [1, { a: 'x' }],
      [0, { a: 'x' }],
      [1, { a: 'x' }],
      [0, { a: 'x' }],
      [1, { a: 'x' }],
      [0, { a: 'x' }],
    ]);
    expect(state.street).toBe('done');
    expect(state.result?.pots).toEqual([{ amount: 20, eligible: [0, 1] }]);
    expect(state.seats.map((s) => s.stack)).toEqual([310, 290]);
    expect(totalStacks(state)).toBe(600);
  });
});
