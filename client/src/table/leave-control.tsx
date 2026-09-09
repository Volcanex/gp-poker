import { useRef } from 'react';
import type { MatchFormat } from '@opentable/protocol';
import { useSession } from '../net/session.tsx';
import { leaveWarning } from './labels.ts';

/* Leaving the game.

   The control sits in the header row beside Copy link and Verify rather than
   anywhere near the action buttons, because the one thing it must never be
   is a fat-finger away from a fold. It is always rendered for a seated
   player and only disabled once the match is over, so the header's box never
   changes size: see `CLAUDE.md` on the footprint.

   A casual or practice table leaves on the press. A ranked one opens the
   dialog first, because leaving costs a rated loss and a place on the
   walkout ladder, and a consequence nobody was told about is not one they
   agreed to. The sentence it warns with comes out of `leaveWarning`, which
   reads the same ladder the server charges from.

   Somebody already out has no stack left to forfeit and nothing left to
   lose by leaving, so the dialog is skipped for them too even at a ranked
   table. */
export function LeaveControl({ format, ended, out, onLeave }: {
  format: MatchFormat;
  ended: boolean;
  out: boolean;
  onLeave: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { me } = useSession();
  const warns = format.rated && !format.practice && !out;

  const press = () => {
    if (warns) ref.current?.showModal();
    else onLeave();
  };

  const confirm = () => {
    ref.current?.close();
    onLeave();
  };

  return (
    <>
      <button
        type="button"
        className="btn btn-tertiary btn-sm"
        disabled={ended}
        onClick={press}
      >
        Leave game
      </button>
      {warns && (
        <LeaveDialog
          ref={ref}
          strikes={me?.walkoutStrikes ?? 0}
          banUntil={me?.rankedBanUntil ?? null}
          onConfirm={confirm}
          onKeep={() => ref.current?.close()}
        />
      )}
    </>
  );
}

/* The warning. Two facts and no more: what leaving does to this match, and
   what it does to the next one. Escape and the backdrop both close it, unlike
   the ready check's dialog, because nothing is running against the player
   while it is open and dismissing it is the same answer as keeping playing.

   Backdrop dismiss is g-ui's own light-dismiss, wired by the `useGInit` on
   the header in `table.tsx`: it walks `.hand-head` on mount and finds every
   `dialog.dlg` under it, which is why this one is rendered there rather than
   anywhere else that would look tidier. */
function LeaveDialog({ ref, strikes, banUntil, onConfirm, onKeep }: {
  ref: React.RefObject<HTMLDialogElement | null>;
  strikes: number;
  banUntil: number | null;
  onConfirm: () => void;
  onKeep: () => void;
}) {
  return (
    <dialog className="dlg" ref={ref} aria-label="Leave this match">
      <div className="dlg-body">
        <span className="dlg-title">Leave this ranked match?</span>
        <span className="dlg-desc">
          The match is forfeited on the spot and rated as a loss.
        </span>
        <span className="dlg-desc">{leaveWarning(strikes, banUntil)}</span>
      </div>
      <div className="dlg-foot">
        <button type="button" className="btn btn-tertiary" onClick={onKeep}>
          Keep playing
        </button>
        <button type="button" className="btn btn-danger" autoFocus onClick={onConfirm}>
          Leave and forfeit
        </button>
      </div>
    </dialog>
  );
}
