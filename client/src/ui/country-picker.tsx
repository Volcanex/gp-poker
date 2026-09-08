import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../net/api.ts';
import { useSession } from '../net/session.tsx';
import { useGInit } from './bits.tsx';
import { COUNTRIES } from './countries.ts';
import { Flag } from './flag.tsx';

/* The one control that sets a player's flag, wherever it is offered. The
   settings menu and your own profile both mount this rather than each wiring a
   list of 249 options to a PATCH: two copies of "which code did they pick"
   would be two chances to send a code the server refuses.

   It is g's combobox, because a select over 249 options is a scroll and this
   one is typed into. g owns the popup, the filtering, the highlight and the
   keyboard; this file owns what a choice means, which is one request. There is
   no save button: the choice is the save, and the toast is what says so.

   The options carry no flags of their own. g renders the whole list into the
   DOM at once, so a flag in every row would be 249 images fetched the moment
   the popup opened, to show one of them. The chosen flag sits beside the
   field, which is where the answer is. */

const NO_FLAG = '';

export interface CountryPickerProps {
  /* Announces the field. Passed in because the settings menu already prints
     "Country" above the row and a second visible label would say it twice. */
  label: string;
  onSaved?: () => void;
}

/* g reads which option is selected once, when it wires the control, and owns
   the field's text from then on. So the picker is not mounted until there is
   an answer to wire it with, and it is remounted when that answer changes
   under it, which is a different account or the other picker on the page
   having just saved. Its own save needs no remount: g has already written the
   name into the field it owns. */
export function CountryPicker(props: CountryPickerProps) {
  const { me } = useSession();
  if (!me) return null;
  return <Picker key={`${me.id}:${me.country ?? ''}`} {...props} current={me.country ?? null} />;
}

function Picker({ label, onSaved, current }: CountryPickerProps & { current: string | null }) {
  const { setMe } = useSession();
  const wrapRef = useRef<HTMLDivElement>(null);
  useGInit(wrapRef);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(
    async (code: string | null) => {
      if (code === current) return;
      setBusy(true);
      setError(null);
      try {
        const updated = await api.setCountry(code);
        setMe(updated);
        window.g?.toast({ title: code ? 'Country saved' : 'Flag removed' });
        onSaved?.();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [current, setMe, onSaved]
  );

  /* g dispatches its own bubbling `change` CustomEvent when an option is
     chosen, which React's synthetic onChange never sees: it is not an input
     event on an input. A native listener on the wrapper is the whole binding. */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onChange = (e: Event) => {
      const value = (e as CustomEvent<{ value?: string }>).detail?.value;
      if (value === undefined) return;
      void save(value === NO_FLAG ? null : value);
    };
    el.addEventListener('change', onChange);
    return () => el.removeEventListener('change', onChange);
  }, [save]);

  /* g filters the list by whatever is in the field, and the field opens
     holding the country already chosen, so clicking it offers exactly the one
     option you are already on. Emptying it on focus is what makes the control
     a search again; g's own blur handler puts the label back when nobody
     chooses, so nothing here has to. The behaviour belongs in g-system's
     combobox rather than in this file, and is flagged as such. */
  useEffect(() => {
    const input = wrapRef.current?.querySelector('input:not([type=hidden])');
    if (!(input instanceof HTMLInputElement)) return;
    const onFocus = () => {
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    input.addEventListener('focus', onFocus);
    return () => input.removeEventListener('focus', onFocus);
  }, []);

  return (
    <div className="country-picker" ref={wrapRef}>
      {/* A fixed box whether or not there is a flag in it, so picking a first
          country does not shove the field along the row. */}
      <span className="country-current" aria-hidden="true">
        {current ? <Flag code={current} size={20} /> : <span className="flag flag-empty" />}
      </span>
      <div className="g-combobox">
        <input className="input" type="text" placeholder="No flag" aria-label={label} disabled={busy} />
        <div className="g-listbox" data-empty-text="No country by that name">
          <CountryOptions selected={current} />
        </div>
      </div>
      {error && <span className="error">{error}</span>}
    </div>
  );
}

/* g stamps an id, a role and a check icon into every option the first time it
   sees the list, so these must never be re-rendered into different elements:
   a replaced child would take g's icon with it. Nothing about them changes
   after the mount, which is what the memo pins. */
const CountryOptions = memo(function CountryOptions({ selected }: { selected: string | null }) {
  return (
    <>
      <div className="g-option" data-value={NO_FLAG} data-label="No flag" aria-selected={selected === null}>
        <span className="g-option-text">No flag</span>
      </div>
      {COUNTRIES.map((c) => (
        <div
          key={c.code}
          className="g-option"
          data-value={c.code}
          data-label={c.name}
          aria-selected={selected === c.code}
        >
          <span className="g-option-text">{c.name}</span>
        </div>
      ))}
    </>
  );
});
