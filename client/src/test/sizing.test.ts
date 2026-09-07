import { describe, expect, it } from 'vitest';
import { clamp, raisePresets } from '../table/sizing.ts';
import { actionText, shortHash, streetText } from '../table/labels.ts';

describe('raisePresets', () => {
  it('sizes a pot raise from the pot after the call', () => {
    // TableView.pot already includes the current street's bets: 98 with 52 in
    // front of the opponent and 18 in front of you. Calling costs 34, so the
    // pot after the call is 132 and a pot-sized raise is to 52 + 132 = 184.
    const p = raisePresets({ actions: ['f', 'c', 'r'], call: 34, min: 86, max: 186 }, 98, 18);
    expect(p.map((x) => x.label)).toEqual(['Min', '½ pot', '¾ pot', 'Pot', 'All in']);
    expect(p.map((x) => x.value)).toEqual([86, 118, 151, 184, 186]);
  });

  it('collapses sizes that land on the same number', () => {
    // Preflop on the button: the minimum raise and a half-pot raise are both 4.
    const p = raisePresets({ actions: ['f', 'c', 'r'], call: 1, min: 4, max: 200 }, 3, 1);
    expect(p.map((x) => x.label)).toEqual(['Min', '¾ pot', 'Pot', 'All in']);
  });

  it('never offers a size outside the legal range', () => {
    const p = raisePresets({ actions: ['b'], call: 0, min: 2, max: 9 }, 400, 0);
    expect(p.every((x) => x.value >= 2 && x.value <= 9)).toBe(true);
  });
});

describe('clamp', () => {
  it('holds the bounds', () => {
    expect(clamp(1, 4, 10)).toBe(4);
    expect(clamp(99, 4, 10)).toBe(10);
    expect(clamp(7, 4, 10)).toBe(7);
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
