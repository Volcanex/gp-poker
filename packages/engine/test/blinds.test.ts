import { describe, expect, it } from 'vitest';
import { apply, createHand, newSeed } from '../src/index.js';
import type { HandConfig } from '../src/index.js';

/* `HandState.blinds` names the two seats the deal charged. It is recorded
   where the blinds are posted rather than re-derived anywhere else, because
   every reader of it (the wire's `SeatView.blind`, the replay) would otherwise
   be counting round from the button on its own and free to drift from the
   seats that actually paid. So every case here asserts the money as well as
   the marker: the seat named is the seat whose chips moved. */

function config(seats: number, button: number): HandConfig {
  return {
    seats: Array.from({ length: seats }, (_, i) => ({ id: `p${i}`, stack: 100 })),
    button,
    sb: 1,
    bb: 2,
    seed: newSeed(),
  };
}

describe('the seats a hand charges', () => {
  it('makes the button the small blind heads-up', () => {
    for (const button of [0, 1]) {
      const state = createHand(config(2, button));
      expect(state.blinds.sb).toBe(button);
      expect(state.blinds.bb).toBe((button + 1) % 2);
      expect(state.seats[state.blinds.sb].bet).toBe(1);
      expect(state.seats[state.blinds.bb].bet).toBe(2);
    }
  });

  it('takes the two seats left of the button multiway', () => {
    for (const seats of [3, 6, 9]) {
      for (let button = 0; button < seats; button++) {
        const state = createHand(config(seats, button));
        expect(state.blinds.sb).toBe((button + 1) % seats);
        expect(state.blinds.bb).toBe((button + 2) % seats);
        expect(state.seats[state.blinds.sb].bet).toBe(1);
        expect(state.seats[state.blinds.bb].bet).toBe(2);
        // And nobody else put anything in before the first decision.
        expect(state.seats.filter((s) => s.bet > 0).length).toBe(2);
        expect(state.seats[button].bet).toBe(0);
      }
    }
  });

  it('says who posted a blind they could not afford in full', () => {
    const cfg = config(3, 0);
    cfg.seats[2] = { id: 'p2', stack: 1 }; // the big blind, all in for half of it
    const state = createHand(cfg);
    expect(state.blinds.bb).toBe(2);
    expect(state.seats[2].bet).toBe(1);
    expect(state.seats[2].allin).toBe(true);
  });

  it('carries the answer through the hand, not just the deal', () => {
    let state = createHand(config(3, 0));
    const blinds = { ...state.blinds };
    state = apply(state, 0, { a: 'f' });
    state = apply(state, 1, { a: 'c' });
    expect(state.blinds).toEqual(blinds);
  });
});
