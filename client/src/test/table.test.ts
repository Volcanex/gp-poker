import { describe, expect, it } from 'vitest';
import { formatFor, HEADS_UP_FORMAT, SIX_MAX_FORMAT } from '@opentable/protocol';
import { dealOrder, layoutMode, portraitSlot, seatOrder, slotAt } from '../table/layout.ts';
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

describe('seat slots', () => {
  it('sits the first seat at the bottom centre and the opposite one at the top', () => {
    const bottom = slotAt(0, 6);
    expect(Math.round(bottom.x)).toBe(50);
    expect(Math.round(bottom.y)).toBe(100);
    expect(bottom.half).toBe('bottom');

    const top = slotAt(3, 6);
    expect(Math.round(top.x)).toBe(50);
    expect(Math.round(top.y)).toBe(0);
    expect(top.half).toBe('top');
  });

  it('runs round to the left, the way the action does', () => {
    const next = slotAt(1, 6);
    expect(next.x).toBeLessThan(50);
    expect(next.y).toBeGreaterThan(50);
    expect(slotAt(5, 6).x).toBeGreaterThan(50);
  });

  it('keeps two seats stacked, which is the heads-up felt', () => {
    expect(slotAt(0, 2).y).toBe(100);
    expect(slotAt(1, 2).y).toBe(0);
  });

  /* Which way a seat faces the middle, so its bet can hang over its own outer
     half. The board and two seats fill the whole felt at the narrower ring, so
     a chip centred on a side seat reaches back onto the board. */
  it('says which side of the ring a seat is on', () => {
    expect(slotAt(0, 6).side).toBe('centre');
    expect(slotAt(3, 6).side).toBe('centre');
    expect([1, 2].map((k) => slotAt(k, 6).side)).toEqual(['left', 'left']);
    expect([4, 5].map((k) => slotAt(k, 6).side)).toEqual(['right', 'right']);
  });

  it('gives a two seat table no sides at all, because it is not a ring', () => {
    expect([slotAt(0, 2).side, slotAt(1, 2).side]).toEqual(['centre', 'centre']);
  });

  it('deals a seat its cards from the middle of the table', () => {
    const bottom = slotAt(0, 6);
    expect(bottom.ox).toBe(0);
    expect(bottom.oy).toBeLessThan(0); // the bottom seat's cards start above it, at the board
    expect(slotAt(1, 6).ox).toBeGreaterThan(0); // a seat on the left starts to its right
  });
});

/* The phone's layout: four rows, your own seat across the bottom, the board
   above it, your two neighbours either side and everyone else along the top.
   Same order round the table as the ellipse, k growing to your left. */
describe('portrait slots', () => {
  it('gives you the whole bottom row', () => {
    for (const n of [3, 4, 5, 6]) {
      expect(portraitSlot(0, n)).toEqual({ row: 4, col: 1, span: 3 });
    }
  });

  it('puts the two players either side of you nearest the board', () => {
    expect(portraitSlot(1, 6)).toEqual({ row: 2, col: 1, span: 1 });
    expect(portraitSlot(5, 6)).toEqual({ row: 2, col: 3, span: 1 });
  });

  it('spreads the rest along the top row', () => {
    expect([2, 3, 4].map((k) => portraitSlot(k, 6).col)).toEqual([1, 2, 3]);
    expect([2, 3, 4].every((k) => portraitSlot(k, 6).row === 1)).toBe(true);
  });

  it('centres a lone far seat and pairs two of them on the outside', () => {
    expect(portraitSlot(2, 4)).toEqual({ row: 1, col: 2, span: 1 });
    expect([2, 3].map((k) => portraitSlot(k, 5).col)).toEqual([1, 3]);
  });

  it('leaves the top row empty when there is nobody to put in it', () => {
    expect([1, 2].map((k) => portraitSlot(k, 3).row)).toEqual([2, 2]);
  });

  it('never puts two seats in one cell', () => {
    for (const n of [3, 4, 5, 6]) {
      const cells = Array.from({ length: n }, (_, k) => portraitSlot(k, n))
        .map((c) => `${c.row}:${c.col}`);
      expect(new Set(cells).size).toBe(n);
    }
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
    expect(blindText(formatFor('six-max', true, 'short'), { sb: 8, bb: 16 }, 12, 4)).toBe(
      'Level 5, blinds 8/16'
    );
    const short = formatFor('heads-up', true, 'short');
    expect(blindText(short, { sb: 200, bb: 400 }, 9, short.levels.length - 1)).toBe(
      `Level ${short.levels.length}, blinds 200/400, top level`
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
