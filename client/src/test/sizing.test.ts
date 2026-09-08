import { describe, expect, it } from 'vitest';
import { clamp, dupKeys, presetsFor, presetsWide } from '../table/sizing.ts';
import { actionText, shortHash, streetText } from '../table/labels.ts';
import { bestFive, handCategory, readShowdown } from '../table/best-five.ts';
import { amountToCall, isLastHand, resolvePreAction, survivesRaise } from '../table/preactions.ts';
import type { LegalActions, SeatView, TableView } from '@opentable/protocol';
import { formatFor } from '@opentable/protocol';

describe('bet sizes', () => {
  it('sizes a pot raise from the pot after the call', () => {
    // TableView.pot already includes the current street's bets: 98 with 52 in
    // front of the opponent and 18 in front of you. Calling costs 34, so the
    // pot after the call is 132 and a pot-sized raise is to 52 + 132 = 184.
    const p = presetsFor({ actions: ['f', 'c', 'r'], call: 34, min: 86, max: 186 }, 98, 18, 'turn');
    expect(p.map((x) => x.label)).toEqual(['Min', '⅓', '½', '⅔', 'Pot', 'All in']);
    expect(p.map((x) => x.value)).toEqual([86, 96, 118, 140, 184, 186]);
  });

  it('thinks in multiples of the bet before the flop', () => {
    // Opening on the button: the big blind is 2, so 3x is a raise to 6.
    const p = presetsFor({ actions: ['f', 'c', 'r'], call: 1, min: 4, max: 200 }, 3, 1, 'pre');
    expect(p.map((x) => x.label)).toEqual(['Min', '2×', '2.5×', '3×', 'Pot', 'All in']);
    expect(p.map((x) => x.value)).toEqual([4, 4, 5, 6, 6, 200]);
  });

  /* Six slots always, in the same order, because the number keys address them.
     Two slots landing on the same number costs nothing now that a preset only
     writes into the field and the button underneath says what will be sent. */
  it('keeps its six slots even when short stacks collapse the sizes', () => {
    const p = presetsFor({ actions: ['b'], call: 0, min: 2, max: 9 }, 400, 0, 'flop');
    expect(p).toHaveLength(6);
    expect(p.every((x) => x.value >= 2 && x.value <= 9)).toBe(true);
  });

  it('offers nothing when there is no raise to make', () => {
    expect(presetsFor({ actions: ['f', 'c'], call: 56, min: 0, max: 0 }, 71, 6, 'pre')).toEqual([]);
  });
});

describe('the wide band\'s ten sizes', () => {
  it('spaces the postflop sizes from a quarter of the pot to one and a half', () => {
    // The same spot as above: pot after the call is 132, on top of the 52 in.
    const p = presetsWide({ actions: ['f', 'c', 'r'], call: 34, min: 86, max: 400 }, 98, 18, 'turn');
    expect(p.map((x) => x.label)).toEqual(
      ['Min', '25%', '33%', '50%', '60%', '75%', '100%', '125%', '150%', 'All in'],
    );
    // A quarter of the pot is a raise to 85 here, under the minimum, so it
    // clamps up to 86 and the min segment owns that number (see below).
    expect(p.map((x) => x.value)).toEqual([86, 86, 96, 118, 131, 151, 184, 217, 250, 400]);
  });

  it('thinks in multiples of the bet before the flop, up to six', () => {
    const p = presetsWide({ actions: ['f', 'c', 'r'], call: 1, min: 4, max: 200 }, 3, 1, 'pre');
    expect(p.map((x) => x.label)).toEqual(
      ['Min', '2×', '2.5×', '3×', '3.5×', '4×', '5×', '6×', 'Pot', 'All in'],
    );
    expect(p.map((x) => x.value)).toEqual([4, 4, 5, 6, 7, 8, 10, 12, 6, 200]);
  });

  it('keeps ten slots when a short stack collapses them, so the keys stay put', () => {
    const p = presetsWide({ actions: ['b'], call: 0, min: 2, max: 9 }, 400, 0, 'flop');
    expect(p).toHaveLength(10);
    expect(p.every((x) => x.value >= 2 && x.value <= 9)).toBe(true);
  });

  it('offers nothing when there is no raise to make', () => {
    expect(presetsWide({ actions: ['f', 'c'], call: 56, min: 0, max: 0 }, 71, 6, 'pre')).toEqual([]);
  });
});

describe('duplicate sizes', () => {
  it('gives a size that clamps to the stack to the all in segment', () => {
    const p = presetsWide({ actions: ['f', 'c', 'r'], call: 34, min: 86, max: 186 }, 98, 18, 'turn');
    expect([...dupKeys(p)].sort()).toEqual(['p125', 'p150', 'p25']);
  });

  it('gives a size that clamps to the minimum to the min segment', () => {
    const p = presetsWide({ actions: ['f', 'c', 'r'], call: 1, min: 4, max: 200 }, 3, 1, 'pre');
    // 2x the bet is 4, which is the minimum, and a pot raise is 6, which 3x
    // already says.
    expect([...dupKeys(p)].sort()).toEqual(['2x', 'pot']);
  });

  it('disables nothing when every size is its own', () => {
    const p = presetsWide({ actions: ['x', 'b'], call: 0, min: 2, max: 400 }, 100, 0, 'flop');
    expect(dupKeys(p).size).toBe(0);
  });
});

describe('clamp', () => {
  it('holds the bounds', () => {
    expect(clamp(1, 4, 10)).toBe(4);
    expect(clamp(99, 4, 10)).toBe(10);
    expect(clamp(7, 4, 10)).toBe(7);
  });
});

describe('the five that count', () => {
  it('picks the flush over the pair it could have made', () => {
    // Kh 9h with 7h 2c Jh Td 4h: four hearts and a king high flush.
    const five = bestFive(['Kh', '9h', '7h', '2c', 'Jh', 'Td', '4h']);
    expect(new Set(five)).toEqual(new Set(['Kh', '9h', '7h', 'Jh', '4h']));
    expect(handCategory(five)).toBe('flush');
  });

  it('reads trips over two pair on a paired board', () => {
    const five = bestFive(['Ac', 'Qd', 'Qs', '9c', '4d', 'Qh', '2s']);
    expect(new Set(five)).toEqual(new Set(['Qd', 'Qs', 'Qh', 'Ac', '9c']));
    expect(handCategory(five)).toBe('three of a kind');
  });

  it('counts the wheel as a straight and the ace as its low card', () => {
    expect(handCategory(bestFive(['Ah', '2c', '3d', '4s', '5h']))).toBe('straight');
  });

  it('prefers the higher straight when both are there', () => {
    const five = bestFive(['9c', '8d', '7s', '6h', '5c', '4d', '3h']);
    expect(new Set(five)).toEqual(new Set(['9c', '8d', '7s', '6h', '5c']));
  });

  it('has no answer for fewer than five cards', () => {
    expect(bestFive(['Ah', 'Kd'])).toEqual([]);
    expect(handCategory([])).toBe('');
  });
});

describe('reading a finished hand', () => {
  const board = ['Qs', '9c', '4d', 'Qh', '2s'];

  it('outlines the winner\'s five and names every hand that was shown', () => {
    const { best, names } = readShowdown({
      awards: [{ seat: 0, amount: 12, hand: 'Three Of A Kind, Queens' }],
      shown: { 0: ['Ac', 'Qd'], 1: ['Kh', '9h'] },
    }, board);
    expect(new Set(best)).toEqual(new Set(['Qd', 'Qs', 'Qh', 'Ac', '9c']));
    expect(names.get(0)).toBe('three of a kind, queens');
    expect(names.get(1)).toBe('two pair');
  });

  /* Nobody called, so nobody showed: there is no winning five to point at, and
     outlining the last hand standing says nothing the fold did not. */
  it('highlights nothing when the pot was uncontested', () => {
    const { best, names } = readShowdown({
      awards: [{ seat: 0, amount: 12 }],
      shown: { 0: ['Ac', 'Qd'] },
    }, board);
    expect(best.size).toBe(0);
    expect(names.size).toBe(0);
  });

  it('has nothing to say about a hand still in play', () => {
    expect(readShowdown(null, board).best.size).toBe(0);
  });
});

/* ------------------------------------------------------------ pre-actions */

const seat = (extra: Partial<SeatView>): SeatView => ({
  i: 0, uid: 'u', name: 'n', rating: 1500, stack: 100, bet: 0, cards: null,
  folded: false, allin: false, button: false, acting: false, connected: true,
  bot: false, out: false, place: null, last: null, ...extra,
});

const view = (seats: SeatView[], extra: Partial<TableView> = {}): TableView => ({
  m: 'm', h: 3, n: 1, street: 'flop', board: [], pot: 0, pots: [], seats, you: 0,
  legal: null, clock: null, seedHash: 'h', seed: null, format: formatFor('heads-up', true),
  blinds: { sb: 1, bb: 2 }, handsPlayed: 2, last: null, result: null, ...extra,
});

const legal = (extra: Partial<LegalActions>): LegalActions =>
  ({ actions: ['f', 'c', 'r'], call: 12, min: 24, max: 200, ...extra });

describe('pre-actions', () => {
  it('reads the price off the seats, because legal is only there on your turn', () => {
    expect(amountToCall(view([seat({ i: 0, bet: 6 }), seat({ i: 1, bet: 20 })]))).toBe(14);
    expect(amountToCall(view([seat({ i: 0, bet: 20 }), seat({ i: 1, bet: 20 })]))).toBe(0);
  });

  it('checks when it can and folds when it cannot', () => {
    expect(resolvePreAction('check-fold', legal({ actions: ['x', 'b'] }))).toBe('x');
    expect(resolvePreAction('check-fold', legal({ actions: ['f', 'c', 'r'] }))).toBe('f');
  });

  it('calls any bet, and checks when there is nothing to call', () => {
    expect(resolvePreAction('call-any', legal({ actions: ['f', 'c', 'r'] }))).toBe('c');
    expect(resolvePreAction('call-any', legal({ actions: ['x', 'b'] }))).toBe('x');
  });

  it('folds to a bet and checks when nobody bet, which is what the words say', () => {
    expect(resolvePreAction('fold-any', legal({ actions: ['f', 'c', 'r'], call: 12 }))).toBe('f');
    expect(resolvePreAction('fold-any', legal({ actions: ['x', 'b'], call: 0 }))).toBe('x');
  });

  it('voids only the pill that assumed nobody would bet', () => {
    expect(survivesRaise('check-fold')).toBe(false);
    expect(survivesRaise('call-any')).toBe(true);
    expect(survivesRaise('fold-any')).toBe(true);
  });
});

describe('the last hand', () => {
  it('knows the match ends when only one stack is left', () => {
    expect(isLastHand(view([seat({ i: 0, stack: 200 }), seat({ i: 1, stack: 0 })]))).toBe(true);
    expect(isLastHand(view([seat({ i: 0, stack: 100 }), seat({ i: 1, stack: 100 })]))).toBe(false);
  });

  it('knows a heads-up match ends at its distance', () => {
    const seats = [seat({ i: 0, stack: 100 }), seat({ i: 1, stack: 100 })];
    expect(isLastHand(view(seats, { h: 25 }))).toBe(true);
    expect(isLastHand(view(seats, { h: 24 }))).toBe(false);
  });

  it('never promises an end to a sit and go that has players left', () => {
    const seats = [0, 1, 2].map((i) => seat({ i, stack: 100 }));
    expect(isLastHand(view(seats, { h: 90, format: formatFor('six-max', true) }))).toBe(false);
  });
});

describe('labels', () => {
  it('reads an action the way the button says it', () => {
    expect(actionText('r', 40)).toBe('Raise to 40');
    expect(actionText('c', 12)).toBe('Call 12');
    expect(actionText('x')).toBe('Check');
    expect(actionText('a')).toBe('All in');
  });

  it('names the streets', () => {
    expect(streetText('pre')).toBe('Preflop');
    expect(streetText('done')).toBe('Hand over');
  });

  it('truncates a seed hash without hiding a short one', () => {
    expect(shortHash('abc')).toBe('abc');
    expect(shortHash('0123456789abcdef')).toBe('0123456789…');
  });
});
