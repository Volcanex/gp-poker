import { useCallback, useState } from 'react';
import { CHAT_HISTORY } from '@opentable/protocol';
import type { ChatFrom, ServerMsg } from '@opentable/protocol';
import { useServerMsg, useSession } from '../net/session.tsx';
import { useNow } from '../ui/bits.tsx';
import { sound } from '../sound/index.ts';
import { appendLine, cooldownLeft, lineId, unreadCount, type ChatLine } from './chat.ts';

export interface ChatController {
  lines: ChatLine[];
  open: boolean;
  toggle: () => void;
  close: () => void;
  unread: number;
  /* Milliseconds until the next message may be sent, counted down here so the
     button can print it. Zero when there is nothing to wait for. */
  cooldownMs: number;
  error: string | null;
  send: (text: string) => void;
  meId: string | null;
  /* True when this viewer has no seat, which is what the panel says out loud:
     a spectator's lines only reach the rail. */
  spectating: boolean;
}

interface ChatState extends Omit<ChatController, 'send'> {
  setError: (msg: string | null) => void;
  setLastSentAt: (at: number | null) => void;
  receive: (from: ChatFrom, text: string, at: number) => void;
}

/* The state a panel needs, whoever is feeding it. Split from the socket half
   so the mock table can drive the same panel with no server behind it. */
function useChatState(meId: string | null, spectating: boolean, seed: ChatLine[] = []): ChatState {
  const [lines, setLines] = useState<ChatLine[]>(seed);
  const [open, setOpen] = useState(false);
  const [seenAt, setSeenAt] = useState(() => Date.now());
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* The countdown only ticks while there is something left to count. */
  const waiting = cooldownLeft(lastSentAt, Date.now()) > 0;
  const now = useNow(waiting, 250);
  const cooldownMs = cooldownLeft(lastSentAt, waiting ? now : Date.now());

  const receive = useCallback((from: ChatFrom, text: string, at: number) => {
    setLines((prev) => appendLine(prev, { id: lineId(from, at), from, text, at }, CHAT_HISTORY));
    if (from.id !== meId) void sound.play('chat');
  }, [meId]);

  /* Opening and closing both mark the conversation read: an open panel is a
     read panel, and closing one you have just been reading must not leave a
     badge behind on the lines you were looking at. */
  const toggle = useCallback(() => {
    setSeenAt(Date.now());
    setOpen((v) => !v);
  }, []);

  const close = useCallback(() => {
    setSeenAt(Date.now());
    setOpen(false);
  }, []);

  return {
    lines,
    open,
    toggle,
    close,
    unread: open ? 0 : unreadCount(lines, seenAt, meId),
    cooldownMs,
    error,
    meId,
    spectating,
    setError,
    setLastSentAt,
    receive,
  };
}

/* A live table. Sends go down the one socket the app holds; a refusal comes
   back as an `err` with the chat code and is printed under the field rather
   than thrown away, because the reason is the whole point of the refusal. */
export function useMatchChat(matchId: string, spectating: boolean): ChatController {
  const { send, me } = useSession();
  const state = useChatState(me?.id ?? null, spectating);
  const { receive, setError, setLastSentAt } = state;

  useServerMsg((m: ServerMsg) => {
    if (m.t === 'chat' && m.m === matchId) {
      receive(m.from, m.text, m.at);
      setError(null);
    } else if (m.t === 'err' && m.c === 'chat') {
      setError(m.msg);
      /* A refused message never happened: the gap is the server's to hold, so
         the field comes straight back rather than waiting out a cooldown the
         send never earned. */
      setLastSentAt(null);
    }
  });

  const sendText = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setError(null);
    setLastSentAt(Date.now());
    send({ t: 'chat', m: matchId, text: trimmed });
  }, [send, matchId, setError, setLastSentAt]);

  return { ...state, send: sendText };
}

/* The mock table, which has no server and needs a conversation anyway: the
   panel has states worth screenshotting and a toggle worth proving does not
   move the felt. A sent message is echoed straight back. */
export function useMockChat(seed: ChatLine[], meId: string, spectating = false): ChatController {
  const state = useChatState(meId, spectating, seed);
  const { receive, setLastSentAt } = state;

  const sendText = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const at = Date.now();
    setLastSentAt(at);
    receive({ id: meId, name: 'You', bot: false, seat: 0 }, trimmed, at);
  }, [receive, setLastSentAt, meId]);

  return { ...state, send: sendText };
}
