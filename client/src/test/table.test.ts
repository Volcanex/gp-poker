import { describe, expect, it } from 'vitest';
import { formatFor, HEADS_UP_FORMAT, SIX_MAX_FORMAT } from '@opentable/protocol';
import { COLUMN_ROWS, columnSizes, dealFrom, dealOrder, layoutMode, placeOf, seatOrder } from '../table/layout.ts';
import { blindText, handText, ordinal } from '../table/labels.ts';
import { rankSeats } from '../table/results.ts';
import type { Match } from '../net/types.ts';

describe('seat rotation', () => {
  const six = [0, 1, 2, 3, 4, 5].map((i) => ({ i }));

  it('puts you at the bottom and the rest in seat order after you', () => {
    expect(seatOrder(six, 3).map((s) => s.i)).toEqual([3, 4, 5, 0, 1, 2]);
    expect(seatOrder(six, 0).map((s) => s.i)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('gives a watcher seat 0 at the bottom, so a replay reads the same way twice', () => {
    expect(seatOrder(six, null).map((s) => s.i)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(seatOrder([{ i: 2 }, { i: 0 }, { i: 5 }], null).map((s) => s.i)).toEqual([0, 2, 5]);
  });

  it('rotates heads-up the same way, which is how that layout survives', () => {
    expect(seatOrder([{ i: 0 }, { i: 1 }], 1).map((s) => s.i)).toEqual([1, 0]);
    expect(layoutMode(2)).toBe('stack');
    expect(layoutMode(3)).toBe('ring');
    expect(layoutMode(6)).toBe('ring');
  });

  it('ignores a seat number that is not at the table', () => {
    expect(seatOrder(six, 9).map((s) => s.i)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

/* The two columns: opponents go round the table from your left, up the left
   column, across the top and down the right one, and the band along the
   bottom is your seat. */
describe('seat places', () => {
  it('divides the opponents left-heavy, so heads-up sits on the left', () => {
    expect(columnSizes(2)).toEqual({ left: 1, right: 0 });
    expect(columnSizes(3)).toEqual({ left: 1, right: 1 });
    expect(columnSizes(4)).toEqual({ left: 2, right: 1 });
    expect(columnSizes(6)).toEqual({ left: 3, right: 2 });
  });

  it('puts the one heads-up opponent at the top of the left column', () => {
    expect(placeOf(1, 2)).toEqual({ col: 'left', row: 1 });
  });

  it('climbs the left column from your left and descends the right one', () => {
    expect([1, 2, 3].map((k) => placeOf(k, 6))).toEqual([
      { col: 'left', row: 3 }, { col: 'left', row: 2 }, { col: 'left', row: 1 },
    ]);
    expect([4, 5].map((k) => placeOf(k, 6))).toEqual([
      { col: 'right', row: 1 }, { col: 'right', row: 2 },
    ]);
  });

  it('packs a short column to its top, level with the board', () => {
    expect([1, 2, 3].map((k) => placeOf(k, 4))).toEqual([
      { col: 'left', row: 2 }, { col: 'left', row: 1 }, { col: 'right', row: 1 },
    ]);
  });

  it('never needs more rows than a column has', () => {
    for (const n of [2, 3, 4, 5, 6]) {
      for (let k = 1; k < n; k += 1) expect(placeOf(k, n)!.row).toBeLessThanOrEqual(COLUMN_ROWS);
    }
  });

  it('never puts two seats in one cell', () => {
    for (const n of [2, 3, 4, 5, 6]) {
      const cells = Array.from({ length: n - 1 }, (_, k) => placeOf(k + 1, n)!)
        .map((c) => `${c.col}:${c.row}`);
      expect(new Set(cells).size).toBe(n - 1);
    }
  });

  it('gives you no place, because the band is your seat', () => {
    expect(placeOf(0, 6)).toBeNull();
    expect(placeOf(6, 6)).toBeNull();
  });

  it('deals every seat its cards from the middle of the table', () => {
    expect(dealFrom(placeOf(1, 6)).x).toBeGreaterThan(0);
    expect(dealFrom(placeOf(5, 6)).x).toBeLessThan(0);
    expect(dealFrom(null).y).toBeLessThan(0);
  });
});

describe('deal order', () => {
  const seats = (cards: (unknown | null)[]) => cards.map((c, i) => ({ i, cards: c }));

  it('starts left of the button and wraps', () => {
    const order = dealOrder(seats(Array(6).fill(['?', '?'])), 5);
    expect(order.get(0)).toBe(0);
    expect(order.get(5)).toBe(5);
    expect(dealOrder(seats(Array(6).fill(['?', '?'])), 2).get(3)).toBe(0);
  });

  it('skips seats with no cards rather than leaving a gap', () => {
    const order = dealOrder(seats([['?'], null, ['?'], ['?'], null, ['?']]), 5);
    expect([...order.keys()].sort((a, b) => a - b)).toEqual([0, 2, 3, 5]);
    expect(order.get(0)).toBe(0);
    expect(order.get(2)).toBe(1);
  });
});

describe('hand header', () => {
  it('promises a hand count only when the match has one', () => {
    expect(handText(12, 25)).toBe('Hand 12 of 25');
    expect(handText(12, null)).toBe('Hand 12');
  });

  it('says the blinds plainly when they never move', () => {
    // A replay builds a format with the one level the hand was dealt at, and
    // nothing to say about a schedule that hand was never part of.
    const flat = { ...HEADS_UP_FORMAT, levels: [{ sb: 1, bb: 2 }], levelSeconds: 0 };
    expect(blindText(flat, { sb: 1, bb: 2 }, 7)).toBe('Blinds 1/2');
  });

  it('names no level on a schedule the player is not climbing', () => {
    // Long heads-up has a ladder, but its hand basis is the whole 25 hand
    // match and its clock basis is a half hour backstop, so a player never
    // meets a level: the header says what the blinds are and stops.
    expect(blindText(HEADS_UP_FORMAT, { sb: 1, bb: 2 }, 7)).toBe('Blinds 1/2');
    // Even once the backstop has fired, which is a fact rather than a place
    // in a schedule anybody was following.
    expect(blindText(HEADS_UP_FORMAT, { sb: 5, bb: 10 }, 7, 1)).toBe('Blinds 5/10');
  });

  it('names the level on a short table, where the clock is the schedule', () => {
    // No hand basis at all, so the level comes off the view rather than off a
    // hand count, and there are no hands to count down to the next one.
    expect(blindText(formatFor('six-max', true, 'fast'), { sb: 8, bb: 16 }, 12, 4)).toBe(
      'Level 5, blinds 8/16'
    );
    const fast = formatFor('heads-up', true, 'fast');
    expect(blindText(fast, { sb: 200, bb: 400 }, 9, fast.levels.length - 1)).toBe(
      `Level ${fast.levels.length}, blinds 200/400, top level`
    );
  });

  it('counts down to the next level when they climb', () => {
    // levels of eight hands: hand 20 is the fourth hand of level three.
    expect(blindText(SIX_MAX_FORMAT, { sb: 3, bb: 6 }, 20)).toBe(
      'Level 3, blinds 3/6, next in 5 hands',
    );
    expect(blindText(SIX_MAX_FORMAT, { sb: 1, bb: 2 }, 8)).toBe(
      'Level 1, blinds 1/2, next in 1 hand',
    );
    expect(blindText(SIX_MAX_FORMAT, { sb: 2, bb: 4 }, 9)).toBe(
      'Level 2, blinds 2/4, next in 8 hands',
    );
  });

  it('stops counting on the last level, where there is nothing to count to', () => {
    const last = SIX_MAX_FORMAT.levels.length;
    const hand = (last - 1) * SIX_MAX_FORMAT.levelHands + 3;
    expect(blindText(SIX_MAX_FORMAT, { sb: 50, bb: 100 }, hand)).toBe(
      `Level ${last}, blinds 50/100, top level`,
    );
  });

  it('reads a finishing position', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21].map(ordinal)).toEqual(
      ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st'],
    );
  });
});

const match = (extra: Partial<Match>): Match => ({
  id: 'm1',
  format: formatFor('six-max', true),
  rated: true,
  seats: [
    { seat: 0, userId: 'a', name: 'ay' },
    { seat: 1, userId: 'b', name: 'bee' },
    { seat: 2, userId: 'c', name: 'cee' },
  ],
  status: 'finished',
  winner: 'c',
  reason: 'bust',
  handsPlayed: 34,
  finalStacks: { a: 0, b: 120, c: 480 },
  ratings: null,
  createdAt: '2026-09-06T14:00:00.000Z',
  finishedAt: '2026-09-06T14:41:00.000Z',
  hands: [],
  ...extra,
});

describe('finishing order', () => {
  it('takes the places the server recorded', () => {
    const rows = rankSeats(match({ places: { a: 3, b: 2, c: 1 } }));
    expect(rows.map((r) => r.seat.userId)).toEqual(['c', 'b', 'a']);
    expect(rows.map((r) => r.place)).toEqual([1, 2, 3]);
    expect(rows.every((r) => r.recorded)).toBe(true);
  });

  it('falls back to the winner and then the deepest stack', () => {
    const rows = rankSeats(match({}));
    expect(rows.map((r) => r.seat.userId)).toEqual(['c', 'b', 'a']);
    expect(rows.map((r) => r.place)).toEqual([1, 2, 3]);
    expect(rows.every((r) => r.recorded)).toBe(false);
  });

  it('keeps a heads-up draw level, both first', () => {
    const rows = rankSeats(
      match({
        seats: [
          { seat: 0, userId: 'a', name: 'ay' },
          { seat: 1, userId: 'b', name: 'bee' },
        ],
        winner: null,
        reason: 'draw',
        finalStacks: { a: 200, b: 200 },
        places: { a: 1, b: 1 },
      }),
    );
    expect(rows.map((r) => r.place)).toEqual([1, 1]);
  });
});
