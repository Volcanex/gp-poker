import { useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { speedsFor } from '@opentable/protocol';
import type { Speed } from '@opentable/protocol';
import { UserPlus } from '@phosphor-icons/react/dist/icons/UserPlus';
import { api, ApiError } from '../net/api.ts';
import { pathUnder, useFriends } from '../net/friends.tsx';
import { readPlayChoice, useSession } from '../net/session.tsx';
import { ClaimCard } from './auth.tsx';
import { useGInit } from './bits.tsx';

/* The friend controls, in one place because five screens carry them: the home
   card, the friends page, a profile, the result of a match and the list of
   people you have played. Each of them asks the same question ("where do I
   stand with this person") and offers the same four answers, so a second copy
   of the answer is a second chance for two screens to disagree.

   A guest gets the claim form instead of a refusal. Friends need a claimed
   account on both sides, and claiming costs a guest nothing: the rating, the
   matches and the histories are already theirs and this only puts a name and
   a password on them. */

export type FriendStanding = 'none' | 'friends' | 'incoming' | 'outgoing';

/* Where the person reading stands with somebody, read off the one list this
   app holds rather than off a field on whatever payload the page fetched: a
   profile loaded a minute ago does not know about a request sent since. */
export function useStanding(userId: string | null): FriendStanding {
  const { data } = useFriends();
  if (!userId || !data) return 'none';
  if (data.friends.some((f) => f.id === userId)) return 'friends';
  if (data.incoming.some((r) => r.id === userId)) return 'incoming';
  if (data.outgoing.some((r) => r.id === userId)) return 'outgoing';
  return 'none';
}

/* The claim prompt, as a thing a control can raise. `ask` opens it and `node`
   is what has to be rendered somewhere; a dialog is in the top layer, so
   where that is does not matter.

   **Nothing is rendered for somebody who has already claimed.** Every friend
   control carries one of these, and a list of twenty rows would otherwise
   put twenty copies of a form nobody can reach into the page, with a name
   field in each of them. The controls ask `useIsPlayer` before they ask, so
   the missing dialog is never one somebody presses through. */
/* The dialog's words default to the friends case, which is where it started;
   the result panel's nudge after a good game passes its own. */
export interface ClaimCopy { title: string; desc: string }
const FRIENDS_CLAIM: ClaimCopy = {
  title: 'Friends need an account',
  desc: 'Pick a name and a password. Your rating, matches and hand histories stay exactly as they are, and your friends have a name to look for.',
};

export function useClaimPrompt(copy: ClaimCopy = FRIENDS_CLAIM): { ask: () => void; node: ReactNode } {
  const ref = useRef<HTMLDialogElement>(null);
  const isPlayer = useIsPlayer();
  return {
    ask: () => ref.current?.showModal(),
    node: isPlayer ? null : <ClaimPrompt ref={ref} copy={copy} />,
  };
}

function ClaimPrompt({ ref, copy }: { ref: React.RefObject<HTMLDialogElement | null>; copy: ClaimCopy }) {
  return (
    <dialog className="dlg" ref={ref} aria-label="Claim your account">
      <div className="dlg-body">
        <span className="dlg-title">{copy.title}</span>
        <span className="dlg-desc">{copy.desc}</span>
        <ClaimCard flat onClaimed={() => ref.current?.close()} />
      </div>
      <div className="dlg-foot">
        <button type="button" className="btn btn-tertiary" onClick={() => ref.current?.close()}>
          Not now
        </button>
      </div>
    </dialog>
  );
}

/* Whether the person reading is somebody who can have friends at all. A
   signed-out or guest browser is offered the claim form by every control
   rather than being shown one that answers no. */
export function useIsPlayer(): boolean {
  const { me } = useSession();
  return me != null && !me.guest;
}

export interface FriendActionProps {
  userId: string;
  name: string;
  /* A bot or your own name has no control at all: the caller decides that,
     because it is the caller who knows whose row this is. */
  size?: 'sm' | 'md';
}

/* Add friend, request sent, accept, or friends with a way out. One control,
   four states, and the state is read from the list rather than held here, so
   two of these on one page cannot disagree. */
export function FriendAction({ userId, name, size = 'sm' }: FriendActionProps) {
  const standing = useStanding(userId);
  const friends = useFriends();
  const isPlayer = useIsPlayer();
  const claim = useClaimPrompt();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menuId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  useGInit(wrapRef);

  const cls = size === 'sm' ? 'btn btn-secondary btn-sm' : 'btn btn-secondary';

  const run = (fn: () => Promise<void>) => async () => {
    if (!isPlayer) {
      claim.ask();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'That did not go through. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  const hide = () => document.getElementById(menuId)?.hidePopover();

  return (
    <span className="friend-action" ref={wrapRef}>
      {standing === 'none' && (
        <button type="button" className={cls} disabled={busy} onClick={run(() => friends.request(name))}>
          <UserPlus size={14} aria-hidden="true" />
          Add friend
        </button>
      )}
      {standing === 'outgoing' && (
        <button
          type="button"
          className={size === 'sm' ? 'btn btn-tertiary btn-sm' : 'btn btn-tertiary'}
          disabled={busy}
          onClick={run(() => friends.remove(userId))}
          title="Cancel this request"
        >
          Request sent
        </button>
      )}
      {standing === 'incoming' && (
        <>
          <button
            type="button"
            className={size === 'sm' ? 'btn btn-primary btn-sm' : 'btn btn-primary'}
            disabled={busy}
            onClick={run(() => friends.accept(userId))}
          >
            Accept
          </button>
          <button
            type="button"
            className="btn btn-tertiary btn-sm"
            disabled={busy}
            onClick={run(() => friends.remove(userId))}
          >
            Decline
          </button>
        </>
      )}
      {standing === 'friends' && (
        <>
          {/* g's own menu, on the same terms the account menu uses it: the
              items call hidePopover themselves, so a re-render cannot leave
              the popover open behind a button that has already acted. */}
          <button type="button" className={cls} popoverTarget={menuId} aria-haspopup="menu">
            Friends
          </button>
          <div className="menu" popover="auto" id={menuId} role="menu">
            <button
              type="button"
              className="menu-item"
              role="menuitem"
              onClick={() => {
                hide();
                void run(() => friends.remove(userId))();
              }}
            >
              Remove friend
            </button>
          </div>
        </>
      )}
      {error && <span className="badge badge-warn">{error}</span>}
      {claim.node}
    </span>
  );
}

/* The one way a name is turned into a request. Its own component because the
   home card's empty state, the friends page and nothing else should ever ask
   for a name, and two copies of "which name did they type" would be two
   chances to send one the server refuses. */
export function AddFriendField({ label = 'Add a friend' }: { label?: string }) {
  const friends = useFriends();
  const isPlayer = useIsPlayer();
  const claim = useClaimPrompt();
  const fieldId = useId();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!isPlayer) {
      claim.ask();
      return;
    }
    setBusy(true);
    setError(null);
    setSent(null);
    try {
      await friends.request(name.trim());
      setSent(name.trim());
      setName('');
    } catch (e2) {
      setError(e2 instanceof ApiError ? e2.message : 'That name could not be added. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <form className="add-friend" onSubmit={submit}>
        <div className="field">
          <label className="label" htmlFor={fieldId}>
            {label}
          </label>
          <input
            className="input"
            id={fieldId}
            value={name}
            placeholder="Their name"
            autoComplete="off"
            onChange={(e) => setName(e.target.value)}
            aria-invalid={error ? true : undefined}
          />
        </div>
        <button type="submit" className="btn btn-secondary" disabled={busy || name.trim().length === 0}>
          Send request
        </button>
        {error && <span className="error">{error}</span>}
        {sent && !error && <span className="muted">Request sent to {sent}.</span>}
      </form>
      {/* Outside the form on purpose: the claim prompt is itself a form, and
          a form inside a form is markup a browser reparents, which is how the
          field above stopped being the only input in its own element. */}
      {claim.node}
    </>
  );
}

/* What an invite offers: heads-up, because that is what a challenge link is,
   at whatever speed and stake this player last chose. A friend pressed into a
   table should get the game the person inviting them plays rather than the
   site's default, which is the reason challenge links carry a speed at all. */
export function invitedFormat(): { speed: Speed; rated: boolean } {
  const choice = readPlayChoice();
  return { speed: speedsFor(choice?.speed ?? 'standard')[0], rated: choice?.rated ?? true };
}

/* Offering a friend a table, from a row or from their profile. It makes an
   ordinary challenge link, which the server pushes to them, and walks the
   person who pressed it to the link's own page: that is the room a creator
   already waits in, and the table is created by the friend's accept exactly
   as it is for a link sent by hand. */
export function InviteButton({
  userId,
  label = 'Play',
  className = 'btn btn-secondary btn-sm',
}: {
  userId: string;
  label?: string;
  className?: string;
}) {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    setBusy(true);
    setError(null);
    try {
      const { speed, rated } = invitedFormat();
      const made = await api.inviteFriend(userId, { kind: 'challenge', speed, rated });
      nav(pathUnder(made.url));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The invite did not go out. Try again.');
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className={className} disabled={busy} onClick={ask}>
        {label}
      </button>
      {error && <span className="badge badge-warn">{error}</span>}
    </>
  );
}
