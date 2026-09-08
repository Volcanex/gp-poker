import { CHAT_MAX_LENGTH, CHAT_MAX_PER_MATCH, CHAT_MIN_GAP_MS } from '@opentable/protocol';

/* Everything a chat message has to survive before a room will repeat it, kept
   pure and away from the room so it can be tested without a table. Two halves:
   what the text has to be (`cleanChatText`) and how often one person may send
   one (`ChatLimiter`). Neither knows about sockets, seats or matches. */

export type ChatRejection = 'empty' | 'too_long' | 'link' | 'too_fast' | 'too_many';

/* The one place a rejection becomes something a person reads. Says what
   happened and what happens next, and never quotes the message back. */
export function chatRejectionText(reason: ChatRejection, waitMs = 0): string {
  switch (reason) {
    case 'empty':
      return 'Type a message before sending it.';
    case 'too_long':
      return `Keep a message to ${CHAT_MAX_LENGTH} characters.`;
    case 'link':
      return 'Links are not allowed here';
    case 'too_fast':
      return `Wait ${Math.ceil(waitMs / 1000)}s before sending again.`;
    case 'too_many':
      return `You have sent the ${CHAT_MAX_PER_MATCH} messages a match allows.`;
  }
}

/* Control characters, including the newlines and tabs a paste brings with it,
   collapse to a single space: a table message is one line, and a run of
   newlines is how a chat panel gets pushed off the screen. U+0000 to U+001F
   and U+007F to U+009F, plus the bidirectional overrides, which are invisible
   and can make a name read backwards. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]+/g;

/* A link is anything a reader could follow. A scheme catches the obvious ones;
   the second pattern catches a bare host, which is how somebody posts a link
   without typing http. The suffix list is deliberately named rather than "any
   word after a dot": a wide rule refuses half the sentences that have a full
   stop in them, and a chat that eats ordinary writing is worse than one that
   lets a rare domain through. */
const SCHEME = /[a-z][a-z0-9+.-]*:\/\//i;
const HOST = /\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.(com|net|org|io|gg|co|uk|us|tv|me|xyz|info|link|app|dev|site|online|club|shop|live|biz|ru|cn|de|fr|nl|pl|es|it|ly|cc|to|sh|ai|gl|be)\b/i;

export function looksLikeLink(text: string): boolean {
  return SCHEME.test(text) || HOST.test(text);
}

export interface CleanChat {
  ok: boolean;
  text: string;
  reason?: ChatRejection;
}

export function cleanChatText(raw: unknown): CleanChat {
  if (typeof raw !== 'string') return { ok: false, text: '', reason: 'empty' };
  const text = raw.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  if (text.length === 0) return { ok: false, text, reason: 'empty' };
  if (text.length > CHAT_MAX_LENGTH) return { ok: false, text, reason: 'too_long' };
  if (looksLikeLink(text)) return { ok: false, text, reason: 'link' };
  return { ok: true, text };
}

/* One person's allowance at one table: a gap between messages and a total for
   the match. The clock is a parameter rather than `Date.now()` so a test can
   drive it, and the counter only moves when a message is actually accepted, so
   a rejected link does not cost anybody one of their twenty. */
export class ChatLimiter {
  private lastAt = new Map<string, number>();
  private sent = new Map<string, number>();

  /* How long this user must wait, 0 when they may send now. */
  waitFor(userId: string, now: number): number {
    const last = this.lastAt.get(userId);
    if (last === undefined) return 0;
    return Math.max(0, last + CHAT_MIN_GAP_MS - now);
  }

  check(userId: string, now: number): ChatRejection | null {
    if ((this.sent.get(userId) ?? 0) >= CHAT_MAX_PER_MATCH) return 'too_many';
    if (this.waitFor(userId, now) > 0) return 'too_fast';
    return null;
  }

  record(userId: string, now: number): void {
    this.lastAt.set(userId, now);
    this.sent.set(userId, (this.sent.get(userId) ?? 0) + 1);
  }
}
