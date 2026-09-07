import { describe, expect, it } from 'vitest';
import { apply, createHand, IllegalAction, legal, newSeed } from '../src/index.js';
import type { HandConfig } from '../src/index.js';

function config(overrides: Partial<HandConfig> = {}): HandConfig {
  return {
    seats: [
      { id: 'a', stack: 100 },
      { id: 'b', stack: 100 },
    ],
    button: 0,
    sb: 1,
    bb: 2,
    seed: newSeed(),
    ...overrides,
  };
}

describe('heads-up order', () => {
  it('button posts sb and acts first preflop; bb acts first postflop', () => {
    let state = createHand(config());
    expect(state.seats[0].bet).toBe(1); // button/sb
    expect(state.seats[1].bet).toBe(2); // bb
    expect(state.toAct).toBe(0);

    state = apply(state, 0, { a: 'c' }); // button calls
    expect(state.street).toBe('pre');
    expect(state.toAct).toBe(1); // bb gets the option

    state = apply(state, 1, { a: 'x' }); // bb checks the option
    expect(state.street).toBe('flop');
    expect(state.toAct).toBe(1); // bb acts first postflop in HU
  });
});

describe('multiway order (3-handed)', () => {
  it('first to act preflop is left of bb; first to act postflop is left of button', () => {
    const cfg = config({
      seats: [
        { id: 'a', stack: 100 },
        { id: 'b', stack: 100 },
        { id: 'c', stack: 100 },
      ],
      button: 0,
    });
    let state = createHand(cfg);
    // sb = seat 1, bb = seat 2, first to act = seat 0 (utg, left of bb)
    expect(state.seats[1].bet).toBe(1);
    expect(state.seats[2].bet).toBe(2);
    expect(state.toAct).toBe(0);

    state = apply(state, 0, { a: 'c' });
    state = apply(state, 1, { a: 'c' });
    state = apply(state, 2, { a: 'x' });
    expect(state.street).toBe('flop');
    expect(state.toAct).toBe(1); // left of button
  });
});

describe('min raise arithmetic', () => {
  it('tracks the raise increment across a raise and a re-raise', () => {
    const cfg = config({
      seats: [
        { id: 'a', stack: 1000 },
        { id: 'b', stack: 1000 },
      ],
    });
    let state = createHand(cfg);
    expect(legal(state, 0).min).toBe(4); // currentBet(2) + minRaise(2)

    state = apply(state, 0, { a: 'r', v: 6 }); // +4 raise
    expect(state.currentBet).toBe(6);
    expect(state.minRaise).toBe(4);
    expect(legal(state, 1).min).toBe(10); // 6 + 4

    state = apply(state, 1, { a: 'r', v: 14 }); // +8 raise
    expect(state.currentBet).toBe(14);
    expect(state.minRaise).toBe(8);
    expect(legal(state, 0).min).toBe(22); // 14 + 8
  });

  it('rejects a raise below the current minimum', () => {
    const cfg = config({
      seats: [
        { id: 'a', stack: 1000 },
        { id: 'b', stack: 1000 },
      ],
    });
    let state = createHand(cfg);
    state = apply(state, 0, { a: 'r', v: 6 });
    expect(() => apply(state, 1, { a: 'r', v: 8 })).toThrow(IllegalAction); // needs >= 10
  });

  it('a short all-in raise does not reopen action for a seat that already acted', () => {
    const cfg = config({
      seats: [
        { id: 'a', stack: 1000 },
        { id: 'b', stack: 1000 },
        { id: 'c', stack: 17 }, // 15 left behind after posting bb=2
      ],
      button: 0,
    });
    let state = createHand(cfg);
    // utg (seat 0) calls, sb (seat 1) calls, bb (seat 2) checks -> flop
    state = apply(state, 0, { a: 'c' });
    state = apply(state, 1, { a: 'c' });
    state = apply(state, 2, { a: 'x' });
    expect(state.street).toBe('flop');
    expect(state.toAct).toBe(1); // left of button

    state = apply(state, 1, { a: 'b', v: 10 }); // currentBet=10, minRaise=10
    expect(state.toAct).toBe(2);
    state = apply(state, 2, { a: 'a' }); // all-in for 15: raise to 15, short of the 20 needed for a full raise
    expect(state.seats[2].allin).toBe(true);
    expect(state.currentBet).toBe(15);
    // seat 0 still needs to act: never acted this street regardless of reopening
    expect(state.toAct).toBe(0);

    state = apply(state, 0, { a: 'f' });
    // seat 1 (bet 10) already acted and the short all-in did not reopen action for them,
    // so the street closes immediately even though seat 1 never matched the extra 5
    expect(state.street).toBe('turn');
    expect(state.seats[1].bet).toBe(0); // reset for the new street
  });
});

describe('check-around', () => {
  it('advances the street when everyone checks', () => {
    const cfg = config({
      seats: [
        { id: 'a', stack: 100 },
        { id: 'b', stack: 100 },
      ],
    });
    let state = createHand(cfg);
    state = apply(state, 0, { a: 'c' });
    state = apply(state, 1, { a: 'x' });
    expect(state.street).toBe('flop');
    state = apply(state, 1, { a: 'x' });
    state = apply(state, 0, { a: 'x' });
    expect(state.street).toBe('turn');
  });
});

describe('bet then fold', () => {
  it('ends the hand immediately without revealing cards', () => {
    const cfg = config({
      seats: [
        { id: 'a', stack: 100 },
        { id: 'b', stack: 100 },
      ],
    });
    let state = createHand(cfg);
    state = apply(state, 0, { a: 'c' });
    state = apply(state, 1, { a: 'x' });
    expect(state.street).toBe('flop');
    state = apply(state, 1, { a: 'b', v: 10 });
    state = apply(state, 0, { a: 'f' });
    expect(state.street).toBe('done');
    expect(state.result).not.toBeNull();
    expect(state.result?.shown).toEqual({});
    expect(state.result?.awards).toEqual([{ seat: 1, amount: 14 }]);
  });
});

describe('calling an all-in', () => {
  it('caps the call at the callers stack when the bet exceeds it', () => {
    const cfg = config({
      seats: [
        { id: 'a', stack: 100 },
        { id: 'b', stack: 5 },
      ],
    });
    let state = createHand(cfg); // seat0 sb=1, seat1 bb=2(all-in already? no, stack5>2)
    // seat0 (button) shoves preflop
    state = apply(state, 0, { a: 'a' });
    expect(state.seats[0].allin).toBe(true);
    // seat1 calls: can only put in remaining stack
    state = apply(state, 1, { a: 'c' });
    expect(state.seats[1].allin).toBe(true);
    expect(state.seats[1].committed).toBe(5);
  });
});

describe('illegal actions', () => {
  it('throws on an amount below min', () => {
    const state = createHand(config());
    expect(() => apply(state, 0, { a: 'r', v: 3 })).toThrow(IllegalAction);
  });

  it('throws on an amount above max', () => {
    const state = createHand(config());
    expect(() => apply(state, 0, { a: 'r', v: 1000 })).toThrow(IllegalAction);
  });

  it('throws when checking is not legal', () => {
    const state = createHand(config());
    expect(() => apply(state, 0, { a: 'x' })).toThrow(IllegalAction);
  });

  it('throws when acting out of turn', () => {
    const state = createHand(config());
    expect(() => apply(state, 1, { a: 'c' })).toThrow(IllegalAction);
  });

  it('throws on a stale action once the hand is done', () => {
    let state = createHand(config());
    state = apply(state, 0, { a: 'f' });
    expect(state.street).toBe('done');
    expect(() => apply(state, 1, { a: 'x' })).toThrow(IllegalAction);
  });
});
