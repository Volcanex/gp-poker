import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CHAT_MAX_LENGTH } from '@opentable/protocol';
import { ChatCircle } from '@phosphor-icons/react/dist/icons/ChatCircle';
import { Avatar } from '../ui/avatar.tsx';
import { avatarVersion } from '../net/adapt.ts';
import { useNow } from '../ui/bits.tsx';
import { QUICK_MESSAGES, canSend, cooldownSeconds, relativeTime } from './chat.ts';
import type { ChatController } from './use-chat.ts';
import './chat.css';

/* The toggle lives in the hand header, at the end of the row. Closed it is
   the word alone: a slot held open for a count that is usually zero read as
   a stray gap after "Chat", which is worse than the word moving the few
   pixels a badge arriving actually costs. The panel it opens is never a row
   of the table's grid: see chat.css. */
export function ChatToggle({ chat }: { chat: ChatController }) {
  return (
    <button
      type="button"
      className="btn btn-tertiary btn-sm chat-toggle"
      data-open={chat.open ? '' : undefined}
      aria-expanded={chat.open}
      aria-controls="table-chat"
      onClick={chat.toggle}
    >
      Chat
      {chat.unread > 0 && <span className="chat-unread num">{chat.unread}</span>}
    </button>
  );
}

/* The phone's toggle: a round button in the felt's bottom right corner, out
   of the flow, with the unread count as a small circle on its shoulder. It
   stands in for the header's word on a phone, where there is no header row
   left to hold it; it is not drawn while the panel is open, because the panel
   is a sheet over that corner and carries its own Close. */
export function ChatFab({ chat }: { chat: ChatController }) {
  if (chat.open) return null;
  return (
    <button
      type="button"
      className="btn btn-secondary chat-fab"
      aria-label={chat.unread > 0 ? `Table chat, ${chat.unread} unread` : 'Table chat'}
      aria-expanded={false}
      aria-controls="table-chat"
      onClick={chat.toggle}
    >
      <ChatCircle size={22} aria-hidden="true" />
      {chat.unread > 0 && <span className="chat-unread num" aria-hidden="true">{chat.unread}</span>}
    </button>
  );
}

export function ChatPanel({ chat }: { chat: ChatController }) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  /* Relative times only need to be right to the minute, and a table has enough
     going on without a second timer on it. */
  const now = useNow(chat.open, 30_000);
  const waiting = cooldownSeconds(chat.cooldownMs);
  const ready = canSend(draft, chat.cooldownMs);

  /* A conversation reads from the bottom. Only the list scrolls, never the
     page: the table behind it must not move because somebody said something.

     **The newest line is scrolled to, not jumped to.** Opening the panel lands
     on the bottom of the log outright, because a panel that animated its way
     down a conversation you have not read yet is a panel you cannot read; a
     line arriving while you are watching it slides, so a message you did not
     see arrive is not simply there. It is the one animation this panel has,
     and reduced motion drops it the way it drops the deal. */
  const landed = useRef(false);
  useEffect(() => {
    if (!chat.open) {
      landed.current = false;
      return;
    }
    const el = listRef.current;
    if (!el) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: landed.current && !still ? 'smooth' : 'auto',
    });
    landed.current = true;
  }, [chat.lines, chat.open]);

  const submit = (text: string) => {
    if (!canSend(text, chat.cooldownMs)) return;
    chat.send(text);
    setDraft('');
  };

  return (
    <aside className="chat-panel" id="table-chat" hidden={!chat.open} aria-label="Table chat">
      <div className="chat-head">
        <span className="chat-title">Table chat</span>
        <button type="button" className="btn btn-tertiary btn-sm" onClick={chat.close}>
          Close
        </button>
      </div>

      {chat.spectating && (
        <p className="chat-note muted">
          You are watching. Only other people watching see what you say.
        </p>
      )}

      <div className="chat-lines" ref={listRef} role="log" aria-live="polite">
        {chat.lines.length === 0 ? (
          <span className="muted chat-empty">Nothing said yet.</span>
        ) : (
          chat.lines.map((line) => (
            <div
              className="chat-line"
              key={line.id}
              data-rail={line.from.seat == null ? '' : undefined}
              data-mine={line.from.id === chat.meId ? '' : undefined}
            >
              <Avatar
                seed={line.from.id}
                name={line.from.name}
                size={20}
                avatarV={avatarVersion(line.from.avatarV)}
              />
              <span className="chat-meta">
                <Link className="chat-name" to={`/u/${line.from.name}`}>{line.from.name}</Link>
                {line.from.seat == null && <span className="chat-rail">Watching</span>}
                {/* A real space in the text, not only in the layout. The row
                    separates the name from the time by pushing the time to the
                    far end, which reads correctly and copies as "Gabrielnow":
                    a flex row drops whitespace-only nodes between its items, so
                    this costs no pixels and gives the line a word boundary for
                    anything reading it as text. */}
                {' '}
                <span className="chat-at num">{relativeTime(line.at, now)}</span>
              </span>
              <span className="chat-text">{line.text}</span>
            </div>
          ))
        )}
      </div>

      <div className="chat-quick">
        {QUICK_MESSAGES.map((text) => (
          <button
            type="button"
            key={text}
            className="btn btn-secondary btn-sm"
            disabled={chat.cooldownMs > 0}
            onClick={() => submit(text)}
          >
            {text}
          </button>
        ))}
      </div>

      <form
        className="chat-send"
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft);
        }}
      >
        <input
          className="input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={CHAT_MAX_LENGTH}
          placeholder="Say something"
          aria-label="Message"
          enterKeyHint="send"
        />
        {/* Tabular, because the countdown ticks in place: without it the button
            is three pixels narrower at 1s than at 2s, which is a layout shift
            the footprint rule does not allow and which chat.spec.ts measures. */}
        <button type="submit" className="btn btn-primary btn-sm chat-send-btn num" disabled={!ready}>
          {waiting > 0 ? `Send in ${waiting}s` : 'Send'}
        </button>
      </form>

      {chat.error && <p className="chat-err" role="alert">{chat.error}</p>}
    </aside>
  );
}
