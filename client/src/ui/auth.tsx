import { useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../net/api.ts';
import { useSession } from '../net/session.tsx';
import { useGInit } from './bits.tsx';
import { modeRating, avatarVersion } from '../net/adapt.ts';
import { MODE_NAME } from './mode-tabs.tsx';
import { int } from './format.ts';
import { Avatar } from './avatar.tsx';
import { Flag } from './flag.tsx';

/* Shown on your own profile while the account is still a guest. The point it
   has to make is that nothing is lost by claiming: the rating is already
   yours, this only puts a name and a password on it. */
export function ClaimCard({ onClaimed }: { onClaimed?: () => void }) {
  const { setMe, refreshMe } = useSession();
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
         is how the top bar ends up disagreeing with the page. */
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
    <form className="card claim" onSubmit={submit}>
      <div className="claim-copy">
        <span className="card-title">Claim this account</span>
        <span className="muted">
          Pick a name and a password. Your rating, matches and hand histories stay exactly as they
          are; claiming only lets you log back in from another browser.
        </span>
      </div>
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
        <button className="btn btn-primary" type="submit" disabled={busy || !name.trim() || !password}>
          Claim this account
        </button>
      </div>
      {error && <span className="error">{error}</span>}
    </form>
  );
}

export function AccountMenu() {
  const { me, refreshMe, queue } = useSession();
  /* Ratings are per mode, so the one in the top bar is the mode you last
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
        {me && <Avatar seed={me.id} name={me.name} size={24} />}
        {me?.country && <Flag code={me.country} size={16} />}
        {me ? me.name : 'Account'}
        {me && <span className="r num">{int(modeRating(me, mode).rating)}</span>}
        {me && <span className="m">{MODE_NAME[mode].toLowerCase()}</span>}
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
        {me?.guest ? (
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
  const { setMe, refreshMe } = useSession();
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
          <span className="dlg-desc">
            Logging in replaces the guest account this browser is using. The guest's rating stays
            with the guest.
          </span>
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
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim() || !password}>
            Log in
          </button>
        </div>
      </form>
    </dialog>
  );
}
