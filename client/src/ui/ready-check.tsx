import { useEffect, useRef } from 'react';
import { READY_CHECK_MS, SPEED_NAME } from '@opentable/protocol';
import { MODE_NAME } from './mode-tabs.tsx';
import { useNow } from './bits.tsx';
import { useSession } from '../net/session.tsx';
import { sound } from '../sound/index.ts';
import { countdownRate } from '../sound/countdown.ts';

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
  const ticked = useRef<string | null>(null);
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
     the table exists they have already had to answer for it.

     Its own sound rather than the table's turn chime, because this is the one
     alert on the site that has to carry from another tab, and it is the only
     one that plays whether or not this tab is the one being looked at. */
  useEffect(() => {
    if (!readyCheck) {
      announced.current = null;
      return;
    }
    if (announced.current === readyCheck.id) return;
    announced.current = readyCheck.id;
    void sound.play('readyCheck');
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

  /* The last ten seconds, one tick each, climbing (`../sound/countdown.ts`).
     Three things keep it quiet where it would be noise rather than pressure:
     a check this player has already answered is not counting down at them any
     more, a hidden tab is not being looked at, and the second is keyed with
     the check's id so a re-render cannot repeat one and two checks cannot
     share one. Declining and running out both simply stop, because neither is
     worth a sound. It sits under `seconds` rather than beside the cue above
     because that is the number it is about. */
  useEffect(() => {
    if (!readyCheck || readyCheck.answered) {
      ticked.current = null;
      return;
    }
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    const rate = countdownRate(seconds);
    if (rate === null) return;
    const key = `${readyCheck.id}:${seconds}`;
    if (ticked.current === key) return;
    ticked.current = key;
    void sound.play('tick', { rate });
  }, [readyCheck, seconds]);

  return (
    <dialog className="dlg ready-dlg" ref={ref} onCancel={holdOpen} onClose={holdOpen} aria-label="Table found">
      {readyCheck && (
        <>
          <div className="dlg-body">
            <span className="dlg-title">Your table is ready</span>
            <span className="dlg-desc">
              {MODE_NAME[readyCheck.mode]}, {SPEED_NAME[readyCheck.speed].toLowerCase()},{' '}
              {readyCheck.rated ? 'ranked' : 'casual'}. Everybody has to accept before it deals.
            </span>
            <div className="ready-count">
              {/* One sentence, not a figure with a caption beside it: the
                  count and the words that name it are the same fact, and the
                  number carries its weight rather than its own size. */}
              <span className="ready-tally">
                <span className="num">{readyCheck.accepted}</span> of{' '}
                <span className="num">{readyCheck.humans}</span> accepted
              </span>
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
              onClick={() => {
                void sound.play('readyAccept');
                answerReady(true);
              }}
            >
              {readyCheck.answered ? 'Accepted' : 'Accept the table'}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
