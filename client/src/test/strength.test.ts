import { describe, expect, test } from 'vitest';
import { STUDS, drawTargets, preflopWords, studOf } from '../analysis/strength.ts';
import { drawWords, studsLabel } from '../analysis/live-stats.tsx';

describe('the strength meter', () => {
  test('nine studs, weakest first, one per category', () => {
    expect(STUDS.length).toBe(9);
    expect(studOf('high card')).toBe(0);
    expect(studOf('pair')).toBe(1);
    expect(studOf('two pair')).toBe(2);
    expect(studOf('three of a kind')).toBe(3);
    expect(studOf('straight')).toBe(4);
    expect(studOf('flush')).toBe(5);
    expect(studOf('full house')).toBe(6);
    expect(studOf('four of a kind')).toBe(7);
    expect(studOf('straight flush')).toBe(8);
  });

  test('a draw aims at the stud it completes on', () => {
    expect(drawTargets(['flush draw'], 'high card')).toEqual([5]);
    expect(drawTargets(['gutshot'], 'pair')).toEqual([4]);
    expect(drawTargets(['open-ended straight draw'], 'pair')).toEqual([4]);
    expect(drawTargets(['two overcards'], 'high card')).toEqual([1]);
  });

  test('two draws are two studs, sorted and never doubled', () => {
    expect(drawTargets(['flush draw', 'gutshot'], 'high card')).toEqual([4, 5]);
    expect(drawTargets(['gutshot', 'open-ended straight draw'], 'high card')).toEqual([4]);
  });

  /* A flush draw on a full house improves nothing the meter can show, and
     overcards on a pair land where the hand already is. */
  test('a draw at or below the made hand marks nothing', () => {
    expect(drawTargets(['flush draw'], 'full house')).toEqual([]);
    expect(drawTargets(['two overcards'], 'pair')).toEqual([]);
    expect(drawTargets(['gutshot'], 'straight')).toEqual([]);
  });

  test('a backdoor draw aims at nothing, and so does no draw', () => {
    expect(drawTargets(['backdoor flush draw'], 'high card')).toEqual([]);
    expect(drawTargets([], 'high card')).toEqual([]);
  });

  test('before the flop every draw is above the hand', () => {
    expect(drawTargets(['flush draw'], null)).toEqual([5]);
  });

  test('the label says the hand and what it is drawing to', () => {
    expect(studsLabel('high card', [])).toBe('High card');
    expect(studsLabel('high card', [5])).toBe('High card, drawing to flush');
    expect(studsLabel('pair', [4, 5])).toBe('Pair, drawing to straight and flush');
    expect(studsLabel(null, [])).toBe('No made hand yet');
  });
});

describe('draw words', () => {
  test('the long names are shortened for the strip, the rest kept', () => {
    expect(drawWords(['flush draw', 'open-ended straight draw'])).toBe('flush draw, open-ender');
    expect(drawWords(['gutshot', 'backdoor flush draw'])).toBe('gutshot, backdoor flush');
    expect(drawWords([])).toBe('');
  });
});

describe('preflop words', () => {
  test('a pair is pocket something', () => {
    expect(preflopWords(['Kh', 'Kd'])).toBe('Pocket kings');
    expect(preflopWords(['6c', '6s'])).toBe('Pocket sixes');
  });

  test('connectors, suited or not, with the ace connecting both ways', () => {
    expect(preflopWords(['9h', '8h'])).toBe('Suited connectors');
    expect(preflopWords(['8h', '9d'])).toBe('Connectors');
    expect(preflopWords(['Ah', 'Kh'])).toBe('Suited connectors');
    expect(preflopWords(['As', '2s'])).toBe('Suited connectors');
  });

  test('a one gapper, and everything else is suited or offsuit', () => {
    expect(preflopWords(['Jh', '9h'])).toBe('Suited one gapper');
    expect(preflopWords(['Jh', '9c'])).toBe('One gapper');
    expect(preflopWords(['Kh', '9h'])).toBe('Suited');
    expect(preflopWords(['Kh', '9c'])).toBe('Offsuit');
    expect(preflopWords(['Ah', '3c'])).toBe('One gapper');
  });
});
