import { describe, expect, it } from 'vitest';
import { replay } from '@opentable/engine';
import type { HandConfig } from '@opentable/engine';
import type { LoggedAction } from '@opentable/protocol';
import { stateToView } from '../replay/to-view.ts';
import { verifyHand, dealFromDeck } from '../replay/fairness.ts';
import type { Hand } from '../net/types.ts';

/* Recorded values, not computed ones: this is what a hand row holds for this
   seed. Deriving them here would only prove the engine agrees with itself. */
const SEED = 'a3f19c47d2b85e60193c7fa4b28d5e01c6a94f37d5b8e20a1f6c3d9047b5e28c';
const SEED_HASH = '2758f1539a11381c77d770d75251755d2e4d1ff1b2d3ad2d0dc6f6fe8ca3ff55';
const HOLES: Record<number, [string, string]> = { 0: ['Ac', 'As'], 1: ['Qd', 'Qh'] };
const BOARD = ['5h', '3d', '8d', 'Kc', '4s'];

const CONFIG: HandConfig = {
  seats: [{ id: 'u-kestrel', stack: 200 }, { id: 'u-riverrat', stack: 200 }],
  button: 0,
  sb: 1,
  bb: 2,
  seed: SEED,
};

/* Button raises to 6, big blind 3bets to 18, button calls; bet and call on the
   flop and the turn; check, bet 60, call on the river. */
const ACTIONS: LoggedAction[] = [
  { s: 0, a: 'r', v: 6, t: 800 },
  { s: 1, a: 'r', v: 18, t: 2400 },
  { s: 0, a: 'c', t: 4000 },
  { s: 1, a: 'b', v: 14, t: 5600 },
  { s: 0, a: 'c', t: 7200 },
  { s: 1, a: 'x', t: 8800 },
  { s: 0, a: 'b', v: 30, t: 10400 },
  { s: 1, a: 'c', t: 12000 },
  { s: 1, a: 'x', t: 13600 },
  { s: 0, a: 'b', v: 60, t: 15200 },
  { s: 1, a: 'c', t: 16800 },
];

const HAND: Hand = {
  id: 'k7f3qm-1',
  matchId: 'k7f3qm',
  number: 1,
  seats: [
    { seat: 0, userId: 'u-kestrel', name: 'kestrel' },
    { seat: 1, userId: 'u-riverrat', name: 'riverrat' },
  ],
  button: 0,
  sb: 1,
  bb: 2,
  stacksStart: [200, 200],
  seedHash: SEED_HASH,
  seed: SEED,
  actions: ACTIONS,
  board: BOARD,
  holes: HOLES,
  result: null,
  stats: null,
  study: null,
  startedAt: '2026-09-06T14:02:00.000Z',
  completedAt: '2026-09-06T14:04:00.000Z',
};

describe('replay stepping', () => {
  const states = replay(CONFIG, ACTIONS);

  it('produces one state per step plus the deal', () => {
    expect(states).toHaveLength(ACTIONS.length + 1);
  });

  it('starts with the blinds posted and the button to act', () => {
    const first = states[0];
    expect(first.street).toBe('pre');
    expect(first.toAct).toBe(0);
    expect(first.seats.map((s) => s.committed)).toEqual([1, 2]);
    expect(first.board).toEqual([]);
  });

  it('opens each street as the betting closes', () => {
    // 3 preflop actions, then the flop; 2 more, then the turn; 3 more, the river.
    expect(states[3].street).toBe('flop');
    expect(states[3].board).toHaveLength(3);
    expect(states[5].street).toBe('turn');
    expect(states[5].board).toHaveLength(4);
    expect(states[8].street).toBe('river');
    expect(states[8].board).toHaveLength(5);
  });

  it('resets the per-street bet but keeps what is committed', () => {
    const afterFlopCall = states[5];
    expect(afterFlopCall.seats.map((s) => s.bet)).toEqual([0, 0]);
    expect(afterFlopCall.seats.map((s) => s.committed)).toEqual([32, 32]);
  });

  it('finishes at a showdown the aces win', () => {
    const last = states[states.length - 1];
    expect(last.street).toBe('done');
    expect(last.result?.awards).toEqual([{ seat: 0, amount: 244, hand: 'One Pair' }]);
    expect(last.seats.map((s) => s.stack)).toEqual([322, 78]);
  });
});

describe('stateToView', () => {
  const states = replay(CONFIG, ACTIONS);

  it('hides the opponent while the hand is running and reveals at the showdown', () => {
    const mid = stateToView(HAND, states[4], 4, false);
    expect(mid.seats.map((s) => s.cards)).toEqual([['?', '?'], ['?', '?']]);
    const end = stateToView(HAND, states[states.length - 1], states.length - 1, false);
    expect(end.seats[0].cards).toEqual(['Ac', 'As']);
    expect(end.seats[1].cards).toEqual(['Qd', 'Qh']);
  });

  it('shows every card when asked, at any step', () => {
    const mid = stateToView(HAND, states[1], 1, true);
    expect(mid.seats.map((s) => s.cards)).toEqual([['Ac', 'As'], ['Qd', 'Qh']]);
  });

  it('carries the pot, the acting seat and the last action of each seat', () => {
    const view = stateToView(HAND, states[2], 2, false);
    expect(view.pot).toBe(24);
    expect(view.seats[0].acting).toBe(true);
    expect(view.seats[1].last).toEqual({ a: 'r', v: 18 });
    expect(view.seats[0].button).toBe(true);
  });

  it('never offers an action bar: a replay is watched, not played', () => {
    const view = stateToView(HAND, states[3], 3, false);
    expect(view.you).toBeNull();
    expect(view.legal).toBeNull();
    expect(view.clock).toBeNull();
  });
});

describe('fairness checks', () => {
  const input = {
    seed: SEED,
    seedHash: SEED_HASH,
    seatCount: 2,
    button: 0,
    holes: HOLES,
    board: BOARD,
  };

  it('passes on a hand that was dealt honestly', () => {
    const checks = verifyHand(input);
    expect(checks.map((c) => c.key)).toEqual(['commitment', 'deck']);
    expect(checks.every((c) => c.ok)).toBe(true);
  });

  it('fails the commitment when the seed is not the one that was committed to', () => {
    const checks = verifyHand({ ...input, seedHash: 'f'.repeat(64) });
    expect(checks.find((c) => c.key === 'commitment')?.ok).toBe(false);
    // The deck still matches the seed; only the promise made beforehand broke.
    expect(checks.find((c) => c.key === 'deck')?.ok).toBe(true);
  });

  it('fails the deck when the recorded cards are not the ones the seed deals', () => {
    const swapped = verifyHand({ ...input, holes: { 0: ['Ac', 'Ad'], 1: ['Qd', 'Qh'] } });
    expect(swapped.find((c) => c.key === 'deck')?.ok).toBe(false);
    expect(swapped.find((c) => c.key === 'deck')?.detail).toContain('hole cards');

    const wrongBoard = verifyHand({ ...input, board: ['5h', '3d', '8d', 'Kc', '4h'] });
    expect(wrongBoard.find((c) => c.key === 'deck')?.ok).toBe(false);
    expect(wrongBoard.find((c) => c.key === 'deck')?.detail).toContain('board');
  });

  it('fails the deck when the hole cards were never recorded', () => {
    expect(verifyHand({ ...input, holes: null }).find((c) => c.key === 'deck')?.ok).toBe(false);
  });
});

describe('dealFromDeck', () => {
  it('deals round robin from the seat left of the button, one card each', () => {
    // Button 0, so seat 1 takes the first and third cards, seat 0 the second
    // and fourth; the board follows straight on with no burn.
    const deck = ['Qd', 'Ac', 'Qh', 'As', '5h', '3d', '8d', 'Kc', '4s', '9c'];
    const dealt = dealFromDeck(deck, 2, 0);
    expect(dealt.holes[1]).toEqual(['Qd', 'Qh']);
    expect(dealt.holes[0]).toEqual(['Ac', 'As']);
    expect(dealt.board).toEqual(['5h', '3d', '8d', 'Kc', '4s']);
  });
});
