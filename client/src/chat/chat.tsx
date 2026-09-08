import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CHAT_MAX_LENGTH } from '@opentable/protocol';
import { Avatar } from '../ui/avatar.tsx';
import { avatarVersion } from '../net/adapt.ts';
import { useNow } from '../ui/bits.tsx';
import { QUICK_MESSAGES, canSend, cooldownSeconds, relativeTime } from './chat.ts';
import type { ChatController } from './use-chat.ts';
import './chat.css';

/* The toggle lives in the hand header, at the end of the row, so the unread
   count can grow without moving anything before it. The panel it opens is
   never a row of the table's grid: see chat.css. */
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
      <span className="chat-unread num" aria-hidden={chat.unread === 0}>
        {chat.unread > 0 ? chat.unread : ''}
      </span>
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
     page: the table behind it must not move because somebody said something. */
  useEffect(() => {
    if (!chat.open) return;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
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
