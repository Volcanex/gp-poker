import { CHAT_MAX_LENGTH, CHAT_MIN_GAP_MS } from '@opentable/protocol';
import type { ChatFrom } from '@opentable/protocol';

/* The pure half of table chat: what a message is on this side of the wire, how
   long the send button stays disabled, and how many lines have gone unread.
   No React, no socket, no clock of its own, so every rule here is a unit test
   rather than a thing to watch happen. */

export interface ChatLine {
  id: string; // stable across re-renders: sender and instant, which cannot repeat
  from: ChatFrom;
  text: string;
  at: number;
}

/* One tap, one sentence. Sentence case, because it is a sentence, and the
   literal text is what gets sent: the button is not a shorthand for something
   longer that the other player would not recognise. */
export const QUICK_MESSAGES = ['Good game', 'Nice hand', 'Thanks', 'Unlucky'] as const;

export function lineId(from: ChatFrom, at: number): string {
  return `${from.id}:${at}`;
}

/* The server holds a gap between one person's messages. The client counts the
   same gap down from the same constant, so the number on the disabled button
   is the number the server would refuse against, rather than a second guess at
   it that drifts the first time either is tuned. */
export function cooldownLeft(lastSentAt: number | null, now: number): number {
  if (lastSentAt == null) return 0;
  return Math.max(0, lastSentAt + CHAT_MIN_GAP_MS - now);
}

/* Seconds, rounded up, because a button saying "Send in 0s" is a button that
   looks broken. Zero only when the wait is genuinely over. */
export function cooldownSeconds(leftMs: number): number {
  return Math.ceil(leftMs / 1000);
}

/* What the toggle counts. Your own lines are never unread: you wrote them, and
   a badge that lights up when you press send reads as a bug. */
export function unreadCount(lines: ChatLine[], seenAt: number, meId: string | null): number {
  return lines.filter((l) => l.at > seenAt && l.from.id !== meId).length;
}

/* Whether the composer would send anything at all. Length is checked here as
   well as on the server so a message that cannot land never leaves: the field
   itself is capped, and this is what catches a paste. */
export function canSend(text: string, leftMs: number): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length <= CHAT_MAX_LENGTH && leftMs === 0;
}

/* Relative time, at the resolution a conversation is read at: a line said a
   moment ago is "now", and past an hour the clock time is more use than a
   count of minutes nobody is adding up. */
export function relativeTime(at: number, now: number): string {
  const secs = Math.floor((now - at) / 1000);
  if (secs < 45) return 'now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${Math.max(1, mins)}m`;
  return new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/* Keeps the last CHAT_HISTORY lines and nothing older, and drops a line the
   room has already sent: a reconnect replays the conversation, and a panel
   that appended it twice would read as everybody repeating themselves. */
export function appendLine(lines: ChatLine[], next: ChatLine, cap: number): ChatLine[] {
  if (lines.some((l) => l.id === next.id && l.text === next.text)) return lines;
  return [...lines, next].slice(-cap);
}
