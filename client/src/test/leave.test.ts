import { describe, expect, it } from 'vitest';
import {
  WALKOUT_DECAY_MS,
  banDurationText,
  rankedBanText,
  walkoutBanMs,
  walkoutStrikesNow,
} from '@opentable/protocol';
import { leaveWarning } from '../table/labels.ts';
import { leaverOf } from '../table/results.ts';
import type { Match } from '../net/types.ts';

/* The sentence the leave dialog warns with, and the ladder under it.

   Every number in the warning has to be the number the server charges, and
   the only thing keeping the two honest is that both read `walkoutBanMs`.
   So these tests assert the sentence against that table rather than against
   a string somebody typed twice. */

const NOW = 1_700_000_000_000;

describe('the walkout warning', () => {
  it('warns about the first walkout without promising a ban for it', () => {
    const text = leaveWarning(0, null, NOW);
    expect(walkoutBanMs(1)).toBe(0);
    expect(text).toContain('counts as a walkout');
    // It says what a second one costs, which is the number that matters to
    // somebody deciding whether to press the button.
    expect(text).toContain(banDurationText(walkoutBanMs(2)));
  });

  it('names the rung the next walkout actually lands on', () => {
    const rungs: [number, string][] = [
      [1, 'second'],
      [2, 'third'],
      [3, 'fourth'],
      [4, 'fifth'],
    ];
    for (const [strikes, word] of rungs) {
      const text = leaveWarning(strikes, null, NOW);
      expect(text).toContain(`your ${word} walkout`);
      expect(text).toContain(banDurationText(walkoutBanMs(strikes + 1)));
    }
  });

  it('stays on the top rung past the end of the ladder', () => {
    expect(walkoutBanMs(9)).toBe(walkoutBanMs(5));
    expect(leaveWarning(8, null, NOW)).toContain(banDurationText(walkoutBanMs(5)));
  });

  it('says when a ban already running ends rather than what the next one costs', () => {
    const text = leaveWarning(2, NOW + 90 * 60_000, NOW);
    expect(text).toContain('2 hours');
    expect(text).toContain('adds a strike');
  });

  it('treats an expired ban as no ban', () => {
    expect(leaveWarning(1, NOW - 1, NOW)).toBe(leaveWarning(1, null, NOW));
  });

  it('keeps to the house voice', () => {
    const texts = [
      leaveWarning(0, null, NOW),
      leaveWarning(3, null, NOW),
      leaveWarning(1, NOW + 60_000, NOW),
      rankedBanText(NOW + 60_000, NOW),
    ];
    for (const text of texts) {
      expect(text).not.toContain('—');
      expect(text).not.toContain('·');
      expect(text.trim().endsWith('.')).toBe(true);
      expect(text[0]).toBe(text[0].toUpperCase());
    }
  });
});

describe('the ladder and its decay', () => {
  it('charges nothing for one strike and eight hours from the fifth', () => {
    expect(walkoutBanMs(0)).toBe(0);
    expect(walkoutBanMs(1)).toBe(0);
    expect(walkoutBanMs(2)).toBe(5 * 60_000);
    expect(walkoutBanMs(3)).toBe(30 * 60_000);
    expect(walkoutBanMs(4)).toBe(2 * 60 * 60_000);
    expect(walkoutBanMs(5)).toBe(8 * 60 * 60_000);
    expect(walkoutBanMs(50)).toBe(8 * 60 * 60_000);
  });

  it('drops one strike a day and stops at nothing', () => {
    const at = NOW;
    expect(walkoutStrikesNow(3, at, at)).toBe(3);
    expect(walkoutStrikesNow(3, at, at + WALKOUT_DECAY_MS - 1)).toBe(3);
    expect(walkoutStrikesNow(3, at, at + WALKOUT_DECAY_MS)).toBe(2);
    expect(walkoutStrikesNow(3, at, at + 2 * WALKOUT_DECAY_MS)).toBe(1);
    expect(walkoutStrikesNow(3, at, at + 9 * WALKOUT_DECAY_MS)).toBe(0);
  });

  it('reads a player who has never walked out as clear', () => {
    expect(walkoutStrikesNow(0, null, NOW)).toBe(0);
    expect(walkoutStrikesNow(4, null, NOW)).toBe(0);
  });
});

/* Who left, derived from the result rather than recorded on it: the server
   places the leaver last among the seats that still had chips, so the answer
   is the worst-placed row that finished with a stack. */
function match(over: Partial<Match>): Match {
  return {
    id: 'm1',
    reason: 'left',
    winner: 'u2',
    seats: [
      { seat: 0, userId: 'u1', name: 'Ann', bot: false },
      { seat: 1, userId: 'u2', name: 'Ben', bot: false },
    ],
    places: { u1: 2, u2: 1 },
    finalStacks: { u1: 40, u2: 60 },
    ...over,
  } as unknown as Match;
}

describe('who left', () => {
  it('is the worst placed seat that still had chips', () => {
    expect(leaverOf(match({}))?.userId).toBe('u1');
  });

  it('is nobody on a match that ended any other way', () => {
    expect(leaverOf(match({ reason: 'bust' }))).toBeNull();
  });

  it('skips the seats that were already busted out', () => {
    const three = match({
      seats: [
        { seat: 0, userId: 'u1', name: 'Ann', bot: false },
        { seat: 1, userId: 'u2', name: 'Ben', bot: false },
        { seat: 2, userId: 'u3', name: 'Cal', bot: false },
      ],
      places: { u1: 2, u2: 1, u3: 3 },
      finalStacks: { u1: 40, u2: 60, u3: 0 },
    } as unknown as Partial<Match>);
    expect(leaverOf(three)?.userId).toBe('u1');
  });
});
