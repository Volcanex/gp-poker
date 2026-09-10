import { describe, expect, test } from 'vitest';
import {
  opponentsLabel,
  outsLine,
  percentLabel,
  precisionLabel,
  readsFor,
  villainsFor,
} from '../analysis/live-stats.tsx';
import { readOuts } from '../analysis/draw-outs.ts';
import { Cancelled, isCancelled, nextRequestId } from '../analysis/index.ts';

describe('live stats helpers', () => {
  test('one villain per opponent, never none and never a table of nine', () => {
    expect(villainsFor(1)).toEqual(['random']);
    expect(villainsFor(5).length).toBe(5);
    expect(villainsFor(0).length).toBe(1);
    expect(villainsFor(99).length).toBe(8);
  });

  test('counts read as words, singular and plural', () => {
    expect(opponentsLabel(1)).toBe('vs 1 random hand');
    expect(opponentsLabel(3)).toBe('vs 3 random hands');
  });

  /* The number at the table is the one a player counts. The category count
     that @opentable/equity returns is a different, larger number, and it is
     only offered when there is no draw to name. */
  test('a named draw is the headline, a category count never is', () => {
    const draw = outsLine({
      cards: [], count: 26, draws: ['open-ended straight draw'],
      drawCards: ['Ts', 'Th', 'Td', 'Tc', '5s', '5h', '5d', '5c'],
    });
    expect(draw).toEqual({
      label: '8 outs',
      cards: ['Ts', 'Th', 'Td', 'Tc', '5s', '5h', '5d', '5c'],
      draws: 'open-ended straight draw',
      muted: false,
    });

    const backdoor = outsLine({ cards: ['Ks'], count: 9, draws: ['backdoor flush draw'], drawCards: [] });
    expect(backdoor?.label).toBe('No draw, but 9 cards help');
    expect(backdoor?.muted).toBe(true);
    expect(backdoor?.draws).toBe('backdoor flush draw');
    const flush = outsLine({ cards: [], count: 15, draws: ['flush draw'], drawCards: ['Kh'] });
    expect(flush?.label).toBe('1 out');

    const none = outsLine({ cards: ['Ah', 'Ad'], count: 2, draws: [], drawCards: [] });
    expect(none).toEqual({ label: 'No draw, but 2 cards help', cards: [], draws: '', muted: true });

    expect(outsLine({ cards: ['Ah'], count: 1, draws: [], drawCards: [] })?.label)
      .toBe('No draw, but 1 card helps');
    expect(outsLine({ cards: [], count: 0, draws: [], drawCards: [] })?.label)
      .toBe('No draw, and nothing helps');
    expect(outsLine(null)).toBe(null);
  });

  test('equity is shown to a tenth of a point', () => {
    expect(percentLabel(0.6238)).toBe('62.4%');
    expect(percentLabel(1)).toBe('100.0%');
  });

  test('says whether a number is the truth or a draw from it', () => {
    expect(precisionLabel(null)).toBe('');
    expect(precisionLabel({ win: 0, tie: 0, lose: 1, equity: 0, samples: 990, exact: true })).toBe('exact');
    expect(precisionLabel({ win: 0, tie: 0, lose: 1, equity: 0, samples: 20000, exact: false })).toBe(
      'sampled, 20,000 deals',
    );
  });

  test('the street decides what can be said', () => {
    expect(readsFor([])).toEqual({ name: false, outs: false });
    expect(readsFor(['Ah', 'Kd', '2c'])).toEqual({ name: true, outs: true });
    expect(readsFor(['Ah', 'Kd', '2c', '7s'])).toEqual({ name: true, outs: true });
    expect(readsFor(['Ah', 'Kd', '2c', '7s', '9h'])).toEqual({ name: true, outs: false });
  });
});

/* readOuts runs in the worker, so these are the numbers the table shows. */
describe('draw outs', () => {
  test('an open-ender is eight and a flush draw is nine', () => {
    const opener = readOuts(['9h', '8c'], ['7d', '6s', '2c']);
    expect(opener.drawCards.length).toBe(8);
    expect(opener.count).toBeGreaterThan(8);
    expect(opener.draws).toContain('open-ended straight draw');

    const flush = readOuts(['Ah', 'Kh'], ['Qh', 'Jh', 'Tc']);
    expect(flush.drawCards.length).toBe(9);
    expect(flush.drawCards.every((c) => c[1] === 'h')).toBe(true);
  });

  test('a gutshot is four, and both draws at once are counted once each', () => {
    expect(readOuts(['Ah', 'Ts'], ['Kd', 'Qc', '4s']).drawCards.length).toBe(4);

    /* Nine hearts and eight straight cards, two of which are hearts already. */
    const combo = readOuts(['9h', '8h'], ['7h', '6c', '2h']);
    expect(combo.draws).toEqual(expect.arrayContaining(['flush draw', 'open-ended straight draw']));
    expect(combo.drawCards.length).toBe(new Set(combo.drawCards).size);
    expect(combo.drawCards.length).toBe(15);
  });

  test('no draw leaves the draw cards empty, so the row falls back to the count', () => {
    const made = readOuts(['Ah', 'Ad'], ['Ac', 'Kd', '7s']);
    expect(made.draws).toEqual([]);
    expect(made.drawCards).toEqual([]);
    expect(made.count).toBeGreaterThan(0);
  });
});

describe('cancellation', () => {
  test('request ids are unique, and a cancellation is recognisable', () => {
    expect(nextRequestId('e')).not.toBe(nextRequestId('e'));
    expect(isCancelled(new Cancelled('e1'))).toBe(true);
    expect(isCancelled(new Error('boom'))).toBe(false);
  });
});
