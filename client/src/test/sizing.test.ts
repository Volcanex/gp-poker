import { describe, expect, it } from 'vitest';
import { DEFAULT_PRESET, clamp, dupKeys, openAt, presetsFor, presetsStack } from '../table/sizing.ts';
import { CUSTOM_KEY, turnKeyAction } from '../table/keys.ts';
import { packOffsets } from '../table/chip-stack.tsx';
import { actionText, faceUp, shortHash, streetText } from '../table/labels.ts';
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

describe('the band\'s six sizes', () => {
  it('spreads them up the stack, not up the pot', () => {
    // The hero has 400 in front of them all told (`legal.max` is the raise-to
    // that puts the lot in), so the ladder is a tenth of that, a quarter, a
    // half, three quarters and all of it. The pot does not come into it: the
    // same six are the same six on every street.
    const p = presetsStack({ actions: ['f', 'c', 'r'], call: 34, min: 86, max: 400 });
    expect(p.map((x) => x.label)).toEqual(['Min', '10%', '25%', '50%', '75%', 'All in']);
    // A tenth of 400 is 40, under the minimum, so it clamps up to 86 and the
    // min box owns that number (see below).
    expect(p.map((x) => x.value)).toEqual([86, 86, 100, 200, 300, 400]);
  });

  it('offers the same six before the flop as after it', () => {
    const p = presetsStack({ actions: ['f', 'c', 'r'], call: 1, min: 4, max: 200 });
    expect(p.map((x) => x.value)).toEqual([4, 20, 50, 100, 150, 200]);
  });

  it('starts a size of your own from the quarter', () => {
    const p = presetsStack({ actions: ['f', 'c', 'r'], call: 1, min: 4, max: 200 });
    expect(p[DEFAULT_PRESET].label).toBe('25%');
    expect(p[DEFAULT_PRESET].value).toBe(50);
  });

  it('steps the sizer up to the first live box when a short stack blanks the quarter', () => {
    // Twenty behind and a minimum raise of eighteen: everything under all in
    // clamps to the minimum, so the quarter is blank and the sizer starts from
    // the all in at the end of the row.
    const p = presetsStack({ actions: ['f', 'c', 'r'], call: 8, min: 18, max: 20 });
    expect(openAt(p, dupKeys(p))).toBe(5);
    // And with nothing blank at all, it is the quarter itself.
    const q = presetsStack({ actions: ['f', 'c', 'r'], call: 1, min: 4, max: 200 });
    expect(openAt(q, dupKeys(q))).toBe(DEFAULT_PRESET);
  });

  it('keeps six slots when a short stack collapses them, so the keys stay put', () => {
    const p = presetsStack({ actions: ['b'], call: 0, min: 2, max: 9 });
    expect(p).toHaveLength(6);
    expect(p.every((x) => x.value >= 2 && x.value <= 9)).toBe(true);
    // All in is always the last box and always says the whole stack.
    expect(p[5].value).toBe(9);
  });

  it('offers nothing when there is no raise to make', () => {
    expect(presetsStack({ actions: ['f', 'c'], call: 56, min: 0, max: 0 })).toEqual([]);
  });
});

describe('duplicate sizes', () => {
  it('gives a size that clamps to the stack to the all in box', () => {
    // Twenty in front of them and a minimum raise of eighteen: every fraction
    // of the stack under the minimum clamps up to it, and the top of the
    // ladder is the all in box's own number.
    const p = presetsStack({ actions: ['f', 'c', 'r'], call: 8, min: 18, max: 20 });
    expect(p.map((x) => x.value)).toEqual([18, 18, 18, 18, 18, 20]);
    expect([...dupKeys(p)].sort()).toEqual(['s10', 's25', 's50', 's75']);
  });

  it('gives a size that clamps to the minimum to the min box', () => {
    const p = presetsStack({ actions: ['f', 'c', 'r'], call: 1, min: 40, max: 200 });
    // A tenth is 20, which clamps to the minimum; a quarter is 50 and is its own.
    expect([...dupKeys(p)].sort()).toEqual(['s10']);
  });

  it('blanks nothing when every size is its own', () => {
    expect(dupKeys(presetsStack({ actions: ['x', 'b'], call: 0, min: 2, max: 400 })).size).toBe(0);
  });
});

describe('the turn keys', () => {
  const legal: LegalActions = { actions: ['f', 'c', 'r'], call: 8, min: 18, max: 400 };
  const presets = presetsStack(legal);
  const at = (key: string, typing = false) => turnKeyAction(key, { legal, presets, typing });

  it('opens a size of your own on 0, beside R and through the same door', () => {
    expect(at(CUSTOM_KEY)).toEqual({ do: 'custom' });
    expect(at('r')).toEqual({ do: 'custom' });
  });

  it('blocks 0 while typing and lets R through', () => {
    // R is how you get back to the field; a 0 while typing is a nought in the
    // amount, not a sizer opening under the cursor.
    expect(at(CUSTOM_KEY, true)).toBeNull();
    expect(at('r', true)).toEqual({ do: 'custom' });
  });

  it('addresses the six sizes by position and answers nothing past them', () => {
    expect(at('1')).toEqual({ do: 'preset', at: 0 });
    expect(at('6')).toEqual({ do: 'preset', at: 5 });
    expect(at('7')).toBeNull();
  });

  it('spends extra time on E, and answers nothing once it is gone', () => {
    // The allowance is the fact off the view, so the key is dead the moment
    // it has been spent rather than sending a second press for the server to
    // drop in silence.
    expect(turnKeyAction('e', { legal, presets, typing: false, extra: true })).toEqual({ do: 'extra' });
    expect(turnKeyAction('E', { legal, presets, typing: false, extra: true })).toEqual({ do: 'extra' });
    expect(turnKeyAction('e', { legal, presets, typing: false, extra: false })).toBeNull();
    // And absent means the same as false: a caller that knows nothing about
    // extra time cannot spend it by leaving the field off.
    expect(at('e')).toBeNull();
  });

  it('blocks E while typing, the way it blocks F', () => {
    // An `e` in the chat is a letter in a word, not two minutes off the clock.
    expect(turnKeyAction('e', { legal, presets, typing: true, extra: true })).toBeNull();
  });

  it('folds, checks and calls, and refuses what the table does not offer', () => {
    expect(at('f')).toEqual({ do: 'fold' });
    expect(at('c')).toEqual({ do: 'checkOrCall', kind: 'c' });
    expect(at('f', true)).toBeNull();
    const noRaise: LegalActions = { actions: ['f', 'c'], call: 56, min: 0, max: 0 };
    expect(turnKeyAction(CUSTOM_KEY, { legal: noRaise, presets: [], typing: false })).toBeNull();
    expect(turnKeyAction('r', { legal: noRaise, presets: [], typing: false })).toBeNull();
  });
});

describe('the pot\'s rack packs under its figure', () => {
  const slots = [500, 100, 25, 5, 1];
  const counts = (...on: number[]) => new Map(on.map((d) => [d, 1]));

  it('closes the gaps and stands the group in the middle', () => {
    // A pot of 3 is three ones, alone in the last of five slots: it moves two
    // columns left, which is the middle. The count is what the transform takes,
    // so left is negative.
    expect(packOffsets(counts(1), slots)).toEqual([0, 0, 0, 0, -2]);
    // A 25 and a one are two columns apart with an empty slot between them:
    // they close up to one column apart and straddle the middle.
    expect(packOffsets(counts(25, 5), slots)).toEqual([0, 0, -0.5, -0.5, 0]);
    expect(packOffsets(counts(25, 1), slots)).toEqual([0, 0, -0.5, 0, -1.5]);
  });

  it('leaves a full rack exactly where it was dealt', () => {
    expect(packOffsets(counts(500, 100, 25, 5, 1), slots)).toEqual([0, 0, 0, 0, 0]);
  });

  it('leaves an empty rack alone', () => {
    expect(packOffsets(new Map(), slots)).toEqual([0, 0, 0, 0, 0]);
  });

  it('counts against the rack it is given, not the whole set', () => {
    // The seat's mini stack draws three denominations, not five.
    expect(packOffsets(counts(25), [500, 100, 25])).toEqual([0, 0, -1]);
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

  it('never promises an end to a heads-up match on the hand count', () => {
    // Heads-up has no distance any more: it is over when somebody's stack is,
    // so the dock must not count down to a result at hand 25 or at hand 250.
    const seats = [seat({ i: 0, stack: 100 }), seat({ i: 1, stack: 100 })];
    expect(isLastHand(view(seats, { h: 25 }))).toBe(false);
    expect(isLastHand(view(seats, { h: 250 }))).toBe(false);
  });

  it('still ends a format that does carry a distance', () => {
    // The mechanism stays, and a stored match from before the cap was dropped
    // still reads correctly on its own format.
    const seats = [seat({ i: 0, stack: 100 }), seat({ i: 1, stack: 100 })];
    const capped = { ...formatFor('heads-up', true), hands: 25 };
    expect(isLastHand(view(seats, { h: 25, format: capped }))).toBe(true);
    expect(isLastHand(view(seats, { h: 24, format: capped }))).toBe(false);
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

  /* The one reading the felt has of "these cards are being shown": a
     showdown, or an all-in run-out from the moment the betting closed. A
     seat that folded keeps its two question marks through a run-out and
     reads false here, which is what keeps it hidden. */
  it('says which holdings are face up', () => {
    expect(faceUp(['Kh', '9h'])).toBe(true);
    expect(faceUp(['?', '?'])).toBe(false);
    expect(faceUp(['??', '??'])).toBe(false);
    expect(faceUp(null)).toBe(false);
    expect(faceUp(undefined)).toBe(false);
    expect(faceUp([])).toBe(false);
    expect(faceUp(['Kh'])).toBe(false);
  });

  it('names the street a run-out is counting to', () => {
    expect(`${streetText('turn')} in 2`).toBe('Turn in 2');
    expect(`${streetText('river')} in 1`).toBe('River in 1');
  });

  it('truncates a seed hash without hiding a short one', () => {
    expect(shortHash('abc')).toBe('abc');
    expect(shortHash('0123456789abcdef')).toBe('0123456789…');
  });
});
