import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../net/api.ts';
import { useSession } from '../net/session.tsx';
import './admin.css';

/* The admin bar, above the site header on every page, and only ever for the
   one account that has the flag. Everything it offers is one thing: get from
   noticing that something is wrong to a ticket about it without leaving the
   page it is wrong on.

   The overlay is a lazy chunk, so the annotation tools are downloaded the
   first time somebody annotates rather than by everybody who loads the site.
   The bar itself is a few hundred bytes and renders null for a player, so
   nothing admin ever reaches anyone else's DOM. */

const Annotate = lazy(() => import('./annotate.tsx').then((m) => ({ default: m.Annotate })));

const HIDE_KEY = 'ot-admin-bar-hidden';
// Saving a ticket has to move the count in a bar that did not do the saving.
// A window event rather than shared state: one producer, one consumer, and
// nothing to keep in sync when the overlay is not mounted.
export const TICKET_SAVED = 'ot:ticket-saved';

function readHidden(): boolean {
  try {
    return sessionStorage.getItem(HIDE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeHidden(hidden: boolean) {
  try {
    if (hidden) sessionStorage.setItem(HIDE_KEY, '1');
    else sessionStorage.removeItem(HIDE_KEY);
  } catch {
    /* private mode: the bar comes back on the next page, which is harmless */
  }
}

/* The shortcut is the same gesture on both platforms, so the hint has to name
   the key that platform actually uses rather than the one this was written
   on. navigator.platform is deprecated and still the only thing that answers
   this without a user-agent guess. */
export function isMac(): boolean {
  return /mac|iphone|ipad|ipod/i.test(navigator.platform || '');
}

export function AdminBar() {
  const { me } = useSession();
  const admin = me?.admin === true;
  const [hidden, setHidden] = useState(readHidden);
  const [open, setOpen] = useState<number | null>(null);
  const [annotating, setAnnotating] = useState(false);

  const refreshCount = useCallback(() => {
    if (!admin) return;
    api
      .tickets('open')
      .then((list) => setOpen(list.length))
      .catch(() => setOpen(null));
  }, [admin]);

  useEffect(() => {
    refreshCount();
    window.addEventListener(TICKET_SAVED, refreshCount);
    return () => window.removeEventListener(TICKET_SAVED, refreshCount);
  }, [refreshCount]);

  /* Cmd+Shift+K on a Mac, Ctrl+Shift+K everywhere else. It fires while a
     field has focus on purpose: the thing being annotated is often the field,
     and no browser or editor claims this combination on a web page. */
  useEffect(() => {
    if (!admin) return;
    const onKey = (e: KeyboardEvent) => {
      const modifier = isMac() ? e.metaKey : e.ctrlKey;
      if (!modifier || !e.shiftKey || e.key.toLowerCase() !== 'k') return;
      e.preventDefault();
      setAnnotating((was) => !was);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [admin]);

  if (!admin) return null;

  const hide = () => {
    writeHidden(true);
    setHidden(true);
  };

  return (
    <>
      {!hidden && (
        <div className="admin-bar" role="region" aria-label="Admin">
          <span className="ab-label">Admin</span>
          <Link className="ab-tickets" to="/admin/tickets">
            Tickets
            {open != null && open > 0 && <span className="badge badge-plain num">{open}</span>}
          </Link>
          <button type="button" className="btn btn-tertiary btn-sm" onClick={() => setAnnotating(true)}>
            Annotate
          </button>
          <span className="ab-hint">
            <kbd className="kbd">{isMac() ? '⌘' : 'Ctrl'}</kbd>
            <kbd className="kbd">{'⇧'}</kbd>
            <kbd className="kbd">K</kbd>
            <span>annotate</span>
          </span>
          <span className="spacer" />
          <button type="button" className="btn btn-tertiary btn-sm" onClick={hide}>
            Hide
          </button>
        </div>
      )}
      {annotating && (
        <Suspense fallback={null}>
          <Annotate onClose={() => setAnnotating(false)} />
        </Suspense>
      )}
    </>
  );
}
