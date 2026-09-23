import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../net/api.ts';
import { useSession } from '../net/session.tsx';
import { useGInit } from './bits.tsx';
import { avatarVersion, levelOf, modeRating } from '../net/adapt.ts';
import { modeInline } from './mode-tabs.tsx';
import { int } from './format.ts';
import { Avatar } from './avatar.tsx';
import { Flag } from './flag.tsx';

/* The default way to claim, own request: it is a link and not a button with
   an onClick because the browser has to end up at Google, which no fetch can
   do; `/auth/google/start` mints the state, remembers where this person was,
   and sends them on (`server/src/google.ts`).

   `next` is the page they are on, so the flow ends where it began rather than
   on the home page. The server accepts only a same-origin path, so nothing
   here has to be trusted to build one.

   Rendered only when the server says it has credentials (`googleAuth` on the
   session): a button that fails at Google is worse than a form. */
function GoogleClaimButton() {
  const { googleAuth } = useSession();
  const location = useLocation();
  if (!googleAuth) return null;
  const next = `${location.pathname}${location.search}`;
  return (
    <div className="row-actions">
      <a className="btn btn-primary" href={`/auth/google/start?next=${encodeURIComponent(next)}`}>
        Continue with Google
      </a>
    </div>
  );
}

/* What the callback's `?ot_auth=` code says out loud. The code is the wire and
   the wording is here, so the server never puts a message on our page and the
   copy can change without a deploy of both halves. Every failure says what
   happened and what to do next; none of them apologises. */
const GOOGLE_RESULTS: Record<string, { title: string; desc?: string; kind?: string }> = {
  ok: { title: 'Signed in with Google', kind: 'ok' },
  denied: { title: 'Google sign-in stopped', desc: 'Nothing changed. Start it again whenever you like.' },
  state: {
    title: 'That sign-in had gone stale',
    desc: 'Continue with Google again to start a fresh one.',
    kind: 'danger',
  },
  google: {
    title: 'Google could not confirm that sign-in',
    desc: 'Nothing changed. Continue with Google again.',
    kind: 'danger',
  },
  linked: {
    title: 'That Google account belongs to another account here',
    desc: 'Log out of this one first, then continue with Google to reach it.',
    kind: 'danger',
  },
  'account-linked': {
    title: 'This account already signs in with a different Google account',
    desc: 'Log out, then continue with Google to reach the other one.',
    kind: 'danger',
  },
  off: {
    title: 'Google sign-in is not set up here',
    desc: 'Claim the account with a name and a password instead.',
    kind: 'danger',
  },
};

/* Mounted once in the shell, because the flow can land on any page: the
   callback sends the browser back where it started with one query parameter,
   and this is what turns that parameter into a toast and takes it back out of
   the URL. Stripping it matters, since a reload or a shared link would
   otherwise say the same thing again about a sign-in that is long over. */
export function GoogleAuthResult() {
  const { refreshMe } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const result = params.get('ot_auth');
    if (!result) return;
    params.delete('ot_auth');
    const search = params.toString();
    navigate(
      { pathname: location.pathname, search: search ? `?${search}` : '', hash: location.hash },
      { replace: true }
    );
    if (result === 'ok') void refreshMe();
    window.g?.toast(GOOGLE_RESULTS[result] ?? GOOGLE_RESULTS.google);
  }, [location.hash, location.pathname, location.search, navigate, refreshMe]);
  return null;
}

/* Shown on your own profile while the account is still a guest. The point it
   has to make is that nothing is lost by claiming: the rating is already
   yours, this only puts a name and a password on it.

   `flat` drops the card ground and the copy above the fields, for a dialog
   that has already said what it is asking for and why: a card inside a dialog
   is a panel on a panel, and a second title is a second heading. The friend
   controls raise it that way (`friend-controls.tsx`). */
export function ClaimCard({ onClaimed, flat }: { onClaimed?: () => void; flat?: boolean }) {
  const { me, setMe, refreshMe, googleAuth } = useSession();
  const nameId = useId();
  const passId = useId();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const user = await api.claim(name.trim(), password);
      /* The summary lands first so the name changes immediately; the full row
         follows, because claiming does not change the counts but a stale /me
         is how the account row ends up disagreeing with the page. */
      setMe(user);
      void refreshMe();
      onClaimed?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={flat ? 'claim' : 'card claim'} onSubmit={submit}>
      {!flat && (
        <div className="claim-copy">
          <span className="card-title">Claim this account</span>
          <span className="muted">
            Continue with Google, or pick a name and a password. Your rating, matches and hand
            histories stay exactly as they are; claiming only lets you log back in from another
            browser.
          </span>
        </div>
      )}
      <GoogleClaimButton />
      {googleAuth && <span className="muted claim-or">Or claim with a name and a password</span>}
      <div className="claim-fields">
        <div className="field">
          <label className="label" htmlFor={nameId}>Name</label>
          <input
            className="input"
            id={nameId}
            value={name}
            autoComplete="username"
            onChange={(e) => setName(e.target.value)}
            aria-invalid={error ? true : undefined}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor={passId}>Password</label>
          <input
            className="input"
            id={passId}
            type="password"
            value={password}
            autoComplete="new-password"
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button className="btn btn-secondary" type="submit" disabled={busy || !name.trim() || !password}>
          Claim this account
        </button>
      </div>
      {error && <span className="error">{error}</span>}
    </form>
  );
}

export function AccountMenu() {
  const { me, refreshMe, queue } = useSession();
  /* Ratings are per mode, so the one on the account row is the mode you last
     played or chose to play. */
  const mode = queue.mode;
  const wrapRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useGInit(wrapRef);

  const hide = () => document.getElementById('account-menu')?.hidePopover();

  const logout = async () => {
    hide();
    try {
      await api.logout();
      await refreshMe();
    } catch {
      /* a failed logout leaves the session alone; the next reload settles it */
    }
  };

  return (
    <div className="account" ref={wrapRef}>
      <button
        type="button"
        className="btn btn-tertiary btn-sm"
        popoverTarget="account-menu"
        aria-haspopup="menu"
      >
        {me && <Avatar seed={me.id} name={me.name} size={24} avatarV={avatarVersion(me.avatarV)} />}
        {/* Sized against this row's text and its 24px avatar, not the seat's
            16px flag: a flag scaled for a much smaller row reads as an
            afterthought beside the name here. */}
        {me?.country && <Flag code={me.country} size={20} />}
        {me ? me.name : 'Account'}
        {me && <span className="r num">{int(modeRating(me, mode).rating)}</span>}
        {me && <span className="m">{modeInline(mode)}</span>}
        {/* How many matches, as a level. It is the last thing in the button
            and the first thing dropped when the bar narrows: the rating is
            what somebody checks here, and the level is what they look at on
            the profile. Nothing until a match has actually been finished. */}
        {me && levelOf(me) > 0 && (
          <span className="lv num" title={`Level ${levelOf(me)}`} aria-label={`Level ${levelOf(me)}`}>
            {levelOf(me)}
          </span>
        )}
      </button>

      <div className="menu" popover="auto" id="account-menu" role="menu">
        {me && (
          <Link className="menu-item" role="menuitem" to={`/u/${encodeURIComponent(me.name)}`} onClick={hide}>
            Your profile
          </Link>
        )}
        <Link className="menu-item" role="menuitem" to="/leaderboard" onClick={hide}>
          Leaderboard
        </Link>
        <hr className="separator" />
        {!me || me.guest ? (
          <button
            type="button"
            className="menu-item"
            role="menuitem"
            onClick={() => {
              hide();
              dialogRef.current?.showModal();
            }}
          >
            Log in
          </button>
        ) : (
          <button type="button" className="menu-item" role="menuitem" onClick={logout}>
            Log out
          </button>
        )}
      </div>

      <LoginDialog ref={dialogRef} />
    </div>
  );
}

function LoginDialog({ ref }: { ref: React.RefObject<HTMLDialogElement | null> }) {
  const { me, setMe, refreshMe, googleAuth } = useSession();
  const nameId = useId();
  const passId = useId();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const user = await api.login(name.trim(), password);
      setMe(user);
      void refreshMe();
      ref.current?.close();
      setName('');
      setPassword('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog className="dlg" ref={ref} aria-label="Log in">
      <form onSubmit={submit}>
        <div className="dlg-body">
          <span className="dlg-title">Log in</span>
          {me ? (
            <span className="dlg-desc">
              You are playing as a guest in this browser. Logging in switches to your account. The
              guest keeps its own rating; it does not come with you. Continuing with Google claims
              this guest instead, so its rating stays with you, unless that Google account already
              has an account here.
            </span>
          ) : (
            <span className="dlg-desc">Log in to the account you play under.</span>
          )}
          {/* The same one button as the claim card: it signs into the account
              this Google identity already has, or claims the guest browsing
              here if it has none. Default, own request: it is offered before
              the name and password rather than below them. */}
          <GoogleClaimButton />
          {googleAuth && <span className="muted claim-or">Or log in with a name and a password</span>}
          <div className="field">
            <label className="label" htmlFor={nameId}>Name</label>
            <input className="input" id={nameId} value={name} autoComplete="username" onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor={passId}>Password</label>
            <input className="input" id={passId} type="password" value={password} autoComplete="current-password" onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <span className="error">{error}</span>}
        </div>
        <div className="dlg-foot">
          <button type="button" className="btn btn-tertiary" onClick={() => ref.current?.close()}>
            Cancel
          </button>
          <button type="submit" className="btn btn-secondary" disabled={busy || !name.trim() || !password}>
            Log in
          </button>
        </div>
      </form>
    </dialog>
  );
}
