import { describe, expect, test } from 'vitest';
import { outs, straightOutCards } from './outs.js';

describe('outs', () => {
  /* Hero holds the made broadway straight with four hearts. Pairing the board
     or either hole card leaves the straight as the best five, so nothing but a
     heart lifts the category: the nine outs a player would quote are the whole
     count here. */
  test('a flush draw is nine cards', () => {
    const result = outs(['Ah', 'Kh'], ['Qh', 'Jh', 'Tc']);
    expect(result.count).toBe(9);
    expect(result.cards.every((c) => c[1] === 'h')).toBe(true);
    expect(result.draws).toContain('flush draw');
  });

  /* An open-ender is eight cards, which is what straightOutCards counts. The
     total is larger because pairing either hole card also improves the category
     from nine high to a pair: see the definition at the top of outs.ts. */
  test('an open-ended straight draw is eight cards', () => {
    const hero: [string, string] = ['9h', '8c'];
    const board = ['7d', '6s', '2c'];
    expect(straightOutCards(hero, board).length).toBe(8);
    expect(outs(hero, board).draws).toContain('open-ended straight draw');
    expect(outs(hero, board).count).toBeGreaterThan(8);
  });

  test('a gutshot is four cards', () => {
    const hero: [string, string] = ['Ah', 'Ts'];
    const board = ['Kd', 'Qc', '4s'];
    expect(straightOutCards(hero, board).length).toBe(4);
    expect(outs(hero, board).draws).toContain('gutshot');
  });

  test('names the other draws it can see', () => {
    expect(outs(['Ah', 'Kd'], ['9c', '5s', '2h']).draws).toContain('two overcards');
    expect(outs(['Ah', '7h'], ['Kh', '9c', '2s']).draws).toContain('backdoor flush draw');
    expect(outs(['Ah', '7h'], ['Kh', '9c', '2s', '4d']).draws).not.toContain('backdoor flush draw');
  });

  test('a board that is four to a straight on its own is nobody in particular\'s draw', () => {
    expect(outs(['Ah', 'Ad'], ['9c', '8s', '7d', '6h']).draws).not.toContain('open-ended straight draw');
  });

  test('needs a flop or a turn', () => {
    expect(() => outs(['Ah', 'Kh'], ['Qh', 'Jh'])).toThrow(/flop or a turn/);
    expect(() => outs(['Ah', 'Kh'], ['Qh', 'Jh', 'Tc', '2d', '3c'])).toThrow(/flop or a turn/);
  });
});
