import { useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../net/api.ts';
import { useSession } from '../net/session.tsx';

/* The one control that renames an account, mounted on your own profile
   beside the picture and the flag: claiming picks a name once, this is the
   same field afterwards, open to a guest and a claimed player alike. There
   is no gate on having claimed, because the name has always belonged to the
   player rather than to the act of claiming (`server/src/auth.ts`'s
   `validateName` is the one rule, shared with the claim form).

   Your profile lives at `/u/:name`, so a rename moves it: `onSaved` fires
   after the redirect, not instead of it, and the caller (the profile page)
   is what is already showing this URL and needs to stop. */
export function RenamePicker({ onSaved }: { onSaved?: () => void }) {
  const { me, setMe } = useSession();
  const nav = useNavigate();
  const id = useId();
  const [name, setName] = useState(me?.name ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!me) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const trimmed = name.trim();
    if (trimmed === me.name) {
      onSaved?.();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await api.rename(trimmed);
      setMe(updated);
      window.g?.toast({ title: 'Name changed' });
      nav(`/u/${encodeURIComponent(updated.name)}`, { replace: true });
      onSaved?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="rename-picker" onSubmit={submit}>
      <div className="field">
        <label className="label" htmlFor={id}>Name</label>
        <input
          className="input"
          id={id}
          value={name}
          autoComplete="username"
          onChange={(e) => setName(e.target.value)}
          aria-invalid={error ? true : undefined}
        />
      </div>
      <div className="row-actions">
        <button className="btn btn-primary btn-sm" type="submit" disabled={busy || !name.trim()}>
          Save name
        </button>
      </div>
      {error && <span className="error">{error}</span>}
    </form>
  );
}
