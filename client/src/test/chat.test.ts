import { describe, expect, it } from 'vitest';
import { CHAT_MAX_LENGTH, CHAT_MIN_GAP_MS } from '@opentable/protocol';
import type { ChatFrom } from '@opentable/protocol';
import {
  QUICK_MESSAGES, appendLine, canSend, cooldownLeft, cooldownSeconds,
  lineId, relativeTime, unreadCount, type ChatLine,
} from '../chat/chat.ts';
import { opponentNames } from '../net/session.tsx';

const seat = (id: string, s: number | null = 0): ChatFrom => ({ id, name: id, bot: false, seat: s });

const line = (id: string, at: number, text = 'hi'): ChatLine => ({
  id: lineId(seat(id), at), from: seat(id), text, at,
});

describe('the send cooldown', () => {
  it('is nothing before anything has been sent', () => {
    expect(cooldownLeft(null, 10_000)).toBe(0);
  });

  it('counts the protocol gap down and stops at zero', () => {
    expect(cooldownLeft(1_000, 1_000)).toBe(CHAT_MIN_GAP_MS);
    expect(cooldownLeft(1_000, 1_000 + CHAT_MIN_GAP_MS / 2)).toBe(CHAT_MIN_GAP_MS / 2);
    expect(cooldownLeft(1_000, 1_000 + CHAT_MIN_GAP_MS)).toBe(0);
    expect(cooldownLeft(1_000, 9_999_999)).toBe(0);
  });

  /* A button reading "Send in 0s" looks broken, so a wait that is still on
     always rounds up to at least one second. */
  it('rounds up to whole seconds, and only reads zero when the wait is over', () => {
    expect(cooldownSeconds(0)).toBe(0);
    expect(cooldownSeconds(1)).toBe(1);
    expect(cooldownSeconds(1_000)).toBe(1);
    expect(cooldownSeconds(1_001)).toBe(2);
    expect(cooldownSeconds(CHAT_MIN_GAP_MS)).toBe(CHAT_MIN_GAP_MS / 1000);
  });

  it('will not send an empty message, an over-long one, or one inside the gap', () => {
    expect(canSend('Nice hand', 0)).toBe(true);
    expect(canSend('   ', 0)).toBe(false);
    expect(canSend('', 0)).toBe(false);
    expect(canSend('a'.repeat(CHAT_MAX_LENGTH), 0)).toBe(true);
    expect(canSend('a'.repeat(CHAT_MAX_LENGTH + 1), 0)).toBe(false);
    expect(canSend('Nice hand', 400)).toBe(false);
  });

  it('offers four quick messages, in sentence case, as the literal text sent', () => {
    expect([...QUICK_MESSAGES]).toEqual(['Good game', 'Nice hand', 'Thanks', 'Unlucky']);
  });
});

describe('the unread count', () => {
  const lines = [line('a', 100), line('me', 200), line('b', 300)];

  it('counts only what arrived after the panel was last read', () => {
    expect(unreadCount(lines, 0, 'me')).toBe(2);
    expect(unreadCount(lines, 150, 'me')).toBe(1);
    expect(unreadCount(lines, 300, 'me')).toBe(0);
  });

  /* Your own message lighting up your own badge reads as a bug. */
  it('never counts your own lines', () => {
    expect(unreadCount([line('me', 500)], 0, 'me')).toBe(0);
    expect(unreadCount([line('me', 500)], 0, 'someone-else')).toBe(1);
  });

  it('counts everything for a viewer with no id of their own', () => {
    expect(unreadCount(lines, 0, null)).toBe(3);
  });
});

describe('appending a line', () => {
  it('keeps the newest and drops what falls off the cap', () => {
    const kept = [line('a', 1), line('b', 2), line('c', 3)].reduce(
      (acc, l) => appendLine(acc, l, 2), [] as ChatLine[],
    );
    expect(kept.map((l) => l.at)).toEqual([2, 3]);
  });

  /* A reconnect replays the conversation. Appending it again would read as
     everybody repeating themselves. */
  it('ignores a line the panel already holds', () => {
    const first = appendLine([], line('a', 1), 100);
    expect(appendLine(first, line('a', 1), 100)).toBe(first);
  });

  it('keeps two different things said in the same millisecond', () => {
    const one = appendLine([], line('a', 1, 'Good game'), 100);
    expect(appendLine(one, line('a', 1, 'Nice hand'), 100)).toHaveLength(2);
  });
});

describe('relative time', () => {
  it('reads as now for the last three quarters of a minute', () => {
    expect(relativeTime(1_000_000, 1_000_000)).toBe('now');
    expect(relativeTime(1_000_000, 1_044_000)).toBe('now');
  });

  it('counts minutes up to an hour, never showing a bare zero', () => {
    expect(relativeTime(1_000_000, 1_050_000)).toBe('1m');
    expect(relativeTime(1_000_000, 1_600_000)).toBe('10m');
    expect(relativeTime(1_000_000, 1_000_000 + 59 * 60_000)).toBe('59m');
  });

  it('gives the clock time past an hour, which is what a reader wants by then', () => {
    const at = Date.UTC(2026, 0, 1, 12, 0, 0);
    expect(relativeTime(at, at + 3 * 60 * 60_000)).not.toMatch(/m$/);
  });
});

describe('naming the other seats', () => {
  it('reads as a sentence, however many there are', () => {
    expect(opponentNames([])).toBeNull();
    expect(opponentNames(['riverrat'])).toBe('riverrat');
    expect(opponentNames(['riverrat', 'quarrel'])).toBe('riverrat and quarrel');
    expect(opponentNames(['a', 'b', 'c'])).toBe('a, b and c');
  });
});
