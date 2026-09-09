import { describe, expect, it } from 'vitest';
import { DENOMINATIONS, chipCount, countsOf, denominate, pay, receive, settle, totalOf } from '../table/chips.ts';

const AMOUNTS = [0, 1, 2, 3, 4, 7, 12, 25, 26, 99, 137, 200, 499, 500, 1200, 1499, 1500];

describe('the chip model', () => {
  it('draws every amount as exactly that amount', () => {
    for (const n of AMOUNTS) expect(totalOf(countsOf(n))).toBe(n);
  });

  it('bounds every column but the top one', () => {
    // Four ones roll into a five, four fives into a twenty five, three
    // twenty fives into a hundred, four hundreds into a five hundred. The
    // felt reserves four rows on that basis, so it has to hold.
    for (const n of AMOUNTS) {
      for (const { value, count } of denominate(n)) {
        if (value !== DENOMINATIONS[0]) expect(count).toBeLessThanOrEqual(4);
      }
    }
  });

  /* The whole point: a rack pays out of what it is holding and keeps the
     rest, so a small bet moves a small number of chips instead of redrawing
     the stack. Greedy re-denomination was the opposite of this. */
  it('keeps the chips a bet did not touch', () => {
    const before = countsOf(1500); // three five-hundreds
    const after = pay(before, 2);
    expect(totalOf(after)).toBe(1498);
    // Two of the three five-hundreds never moved.
    expect(after.get(500)).toBe(2);
  });

  it('breaks a chip when nothing smaller is held', () => {
    const before = countsOf(100); // one hundred
    const after = pay(before, 25);
    expect(totalOf(after)).toBe(75);
    expect(before.get(100)).toBe(1);
    // Paid with change: the hundred is gone and what is left is in smaller
    // chips, none of them larger than the amount that stayed.
    expect(after.get(100) ?? 0).toBe(0);
  });

  it('conserves value through any sequence of bets and wins', () => {
    let rack = countsOf(1500);
    let expected = 1500;
    for (const move of [-2, -6, +14, -75, -1, +300, -499, +8, -137]) {
      rack = move < 0 ? pay(rack, -move) : receive(rack, move);
      expected += move;
      expect(totalOf(rack)).toBe(expected);
    }
  });

  it('never pays out more than it holds', () => {
    const rack = countsOf(40);
    expect(totalOf(pay(rack, 1000))).toBe(0);
  });

  it('settles to the figure beside it either way', () => {
    const rack = countsOf(137);
    expect(totalOf(settle(rack, 400))).toBe(400);
    expect(totalOf(settle(rack, 9))).toBe(9);
    expect(settle(rack, 137)).toBe(rack);
  });

  /* Paying never drifts: breaking a chip into the one below it and paying
     from that reproduces the greedy split of whatever is left. **Winning
     does**, which is why the blind change has something to tidy: four ones
     and one more are five ones until somebody colours them up. */
  it('drifts on what it is paid, and the tidy form is the way back', () => {
    let rack = countsOf(4); // four ones
    rack = receive(rack, 1);
    expect(totalOf(rack)).toBe(5);
    expect(chipCount(rack)).toBe(5);
    expect(chipCount(countsOf(5))).toBe(1);
  });

  it('is never tidier than the tidy form, whatever it has been through', () => {
    let rack = countsOf(1500);
    for (const move of [-1, +3, -27, +1, +1, -2, +140, -3]) {
      rack = move < 0 ? pay(rack, -move) : receive(rack, move);
      expect(chipCount(rack)).toBeGreaterThanOrEqual(chipCount(countsOf(totalOf(rack))));
    }
  });
});
