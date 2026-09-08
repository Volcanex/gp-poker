import { useEffect, useRef } from 'react';
import { READY_CHECK_MS, SPEED_NAME } from '@opentable/protocol';
import { MODE_NAME } from './mode-tabs.tsx';
import { useNow } from './bits.tsx';
import { useSession } from '../net/session.tsx';
import { sound } from '../sound/index.ts';

/* The ready check: the table has been found and is waiting on the people at
   it. Site-wide, like the match found toast beside it in `presence.tsx`, and
   for the same reason: the whole point of a ready check is that it reaches
   you where you actually are.

   It is a modal rather than a toast because it is the one thing on the site
   that is worth interrupting for. Twenty seconds of not answering costs the
   other five people their table and costs you a cooldown, so it takes the
   screen, it takes the focus, and the accept button is the only thing under
   the cursor. */
export function ReadyCheckDialog() {
  const { readyCheck, answerReady } = useSession();
  const ref = useRef<HTMLDialogElement>(null);
  const announced = useRef<string | null>(null);
  const now = useNow(readyCheck !== null, 100);

  /* The dialog is opened and closed by the server's own state and by nothing
     else. There is no dismiss: a check ends by being answered or by running
     out, and a browser that closed it locally would still be in it. */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (readyCheck && !el.open) el.showModal();
    if (!readyCheck && el.open) el.close();
  }, [readyCheck]);

  /* One cue per check, on the check itself rather than on the table it turns
     into: the sound is what brings somebody back to the tab, and by the time
     the table exists they have already had to answer for it. */
  useEffect(() => {
    if (!readyCheck) {
      announced.current = null;
      return;
    }
    if (announced.current === readyCheck.id) return;
    announced.current = readyCheck.id;
    void sound.play('yourTurn');
  }, [readyCheck]);

  /* Escape closes a native dialog. Here it would leave somebody looking at a
     page with a check still running against them, so the close is refused and
     the prompt stays until it is answered. */
  const holdOpen = (e: React.SyntheticEvent<HTMLDialogElement>) => {
    if (readyCheck) e.preventDefault();
  };

  const left = readyCheck ? Math.max(0, readyCheck.deadline - now) : 0;
  const seconds = Math.ceil(left / 1000);
  const share = readyCheck ? Math.max(0, Math.min(1, left / READY_CHECK_MS)) : 0;
  const pct = Math.round(share * 100);

  return (
    <dialog className="dlg ready-dlg" ref={ref} onCancel={holdOpen} onClose={holdOpen} aria-label="Table found">
      {readyCheck && (
        <>
          <div className="dlg-body">
            <span className="dlg-title">Your table is ready</span>
            <span className="dlg-desc">
              {MODE_NAME[readyCheck.mode]}, {SPEED_NAME[readyCheck.speed].toLowerCase()},{' '}
              {readyCheck.rated ? 'rated' : 'casual'}. Everybody has to accept before it deals.
            </span>
            <div className="ready-count">
              <span className="num">{readyCheck.accepted}</span>
              <span className="muted">of {readyCheck.humans} accepted</span>
              <span style={{ flex: 1 }} />
              <span className="num ready-clock" aria-hidden="true">{seconds}s</span>
            </div>
            <span
              className="g-progress ready-bar"
              role="progressbar"
              aria-label="Time left to accept"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
            >
              <span className="g-progress-fill" style={{ width: `${pct}%` }} />
            </span>
            <span className="muted">
              {readyCheck.answered
                ? 'Waiting for the rest of the table.'
                : 'Decline or let this run out and you will wait before you can search again.'}
            </span>
          </div>
          <div className="dlg-foot">
            <button
              type="button"
              className="btn btn-tertiary"
              disabled={readyCheck.answered}
              onClick={() => answerReady(false)}
            >
              Decline
            </button>
            <button
              type="button"
              className="btn btn-primary"
              autoFocus
              disabled={readyCheck.answered}
              onClick={() => answerReady(true)}
            >
              {readyCheck.answered ? 'Accepted' : 'Accept the table'}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
