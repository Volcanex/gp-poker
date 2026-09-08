import { useRef } from 'react';
import type { Mode } from '@opentable/protocol';
import { useGInit } from './bits.tsx';

/* Six handed first, everywhere a pair of modes is offered: it is the main
   game now, and a tab strip that opens on the sideshow says otherwise. */
export const MODES: Mode[] = ['six-max', 'heads-up'];
export const MODE_NAME: Record<Mode, string> = { 'heads-up': 'Heads-up', 'six-max': 'Six-max' };

export interface ModeTabsProps {
  mode: Mode;
  onPick: (m: Mode) => void;
  label: string; // what this pair of tabs switches, for a screen reader
}

/* g's tabs, wired by g-ui: it owns `aria-selected`, the roving tab index and
   the sliding indicator from the moment it initialises them. So the attribute
   is rendered from the mode this mounted with and never changes on a re-render
   (React writes an unchanged prop once, at mount), and both handlers read the
   selection back out of the DOM instead of setting it. The same co-ownership
   as the copy button and the account menu; see client/CLAUDE.md. */
export function ModeTabs({ mode, onPick, label }: ModeTabsProps) {
  const wrap = useRef<HTMLDivElement>(null);
  useGInit(wrap);
  const mounted = useRef(mode).current;

  const read = (el: HTMLElement) => {
    const picked = el.querySelector('.tab[aria-selected="true"]');
    const next = picked?.getAttribute('data-mode') as Mode | null;
    if (next && next !== mode) onPick(next);
  };

  return (
    <div className="mode-tabs" ref={wrap}>
      <div
        className="tabs"
        role="tablist"
        aria-label={label}
        onClick={(e) => read(e.currentTarget)}
        onKeyUp={(e) => read(e.currentTarget)}
      >
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            className="tab"
            data-mode={m}
            aria-selected={m === mounted}
            tabIndex={m === mounted ? 0 : -1}
          >
            {MODE_NAME[m]}
          </button>
        ))}
      </div>
    </div>
  );
}
