import { useEffect, useRef } from 'react';
import { useGInit } from './bits.tsx';

/* A two-or-more option switcher, which is g's shipped tabs and not a new
   component. g-system does not ship a segmented control, and the rule is to
   use what exists before extending and to build anything genuinely new in
   g-system rather than one-off in a consumer, so this is a wrapper over
   `.tabs` and nothing more: no new class, no new token, no new markup.

   g-ui owns the parts of a tab strip that move. From the moment it
   initialises one it holds `aria-selected`, the roving tab index and the
   sliding indicator, so React renders the selection **once, at mount**, and
   never writes the attribute again: an unchanged prop is written once and a
   changed one would fight g-ui for the same attribute. Both handlers read the
   selection back out of the DOM instead of setting it.

   That leaves one case the DOM cannot answer for: a value changed from
   outside, which here is the pinned game type arriving with the player's
   account after the panel has already mounted. `sync` handles it by clicking
   the tab, so g-ui does the moving and there is still exactly one thing that
   owns the attribute. The click lands back on `read`, which sees the value it
   already has and stops. */
export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onPick: (value: T) => void;
  label: string; // what this switcher switches, for a screen reader
  disabled?: (value: T) => boolean;
}

export function Segmented<T extends string>({ options, value, onPick, label, disabled }: SegmentedProps<T>) {
  const wrap = useRef<HTMLDivElement>(null);
  useGInit(wrap);
  const mounted = useRef(value).current;

  const read = (el: HTMLElement) => {
    const picked = el.querySelector('.tab[aria-selected="true"]');
    const next = picked?.getAttribute('data-value') as T | null;
    if (next && next !== value) onPick(next);
  };

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const selected = el.querySelector('.tab[aria-selected="true"]')?.getAttribute('data-value');
    if (selected === value) return;
    el.querySelector<HTMLButtonElement>(`.tab[data-value="${value}"]`)?.click();
  }, [value]);

  return (
    <div className="mode-tabs" ref={wrap}>
      <div
        className="tabs"
        role="tablist"
        aria-label={label}
        onClick={(e) => read(e.currentTarget)}
        onKeyUp={(e) => read(e.currentTarget)}
      >
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="tab"
            className="tab"
            data-value={o.value}
            disabled={disabled?.(o.value)}
            aria-selected={o.value === mounted}
            tabIndex={o.value === mounted ? 0 : -1}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
