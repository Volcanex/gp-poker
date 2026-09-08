import { describe, expect, test } from 'vitest';
import {
  opponentsLabel,
  outsLabel,
  percentLabel,
  precisionLabel,
  readsFor,
  villainsFor,
} from '../analysis/live-stats.tsx';
import { Cancelled, isCancelled, nextRequestId } from '../analysis/index.ts';

describe('live stats helpers', () => {
  test('one villain per opponent, never none and never a table of nine', () => {
    expect(villainsFor(1)).toEqual(['random']);
    expect(villainsFor(5).length).toBe(5);
    expect(villainsFor(0).length).toBe(1);
    expect(villainsFor(99).length).toBe(8);
  });

  test('counts read as words, singular and plural', () => {
    expect(outsLabel(0)).toBe('No outs');
    expect(outsLabel(1)).toBe('1 out');
    expect(outsLabel(9)).toBe('9 outs');
    expect(opponentsLabel(1)).toBe('vs 1 random hand');
    expect(opponentsLabel(3)).toBe('vs 3 random hands');
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

describe('cancellation', () => {
  test('request ids are unique, and a cancellation is recognisable', () => {
    expect(nextRequestId('e')).not.toBe(nextRequestId('e'));
    expect(isCancelled(new Cancelled('e1'))).toBe(true);
    expect(isCancelled(new Error('boom'))).toBe(false);
  });
});
