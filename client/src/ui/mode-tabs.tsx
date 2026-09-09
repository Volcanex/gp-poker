import type { Mode } from '@opentable/protocol';
import { Segmented } from './segmented.tsx';

/* Six handed first, everywhere a pair of modes is offered: it is the main
   game now, and a tab strip that opens on the sideshow says otherwise. */
export const MODES: Mode[] = ['six-max', 'heads-up'];
/* Six-max reads as "6X" everywhere the site names it, own request: short for
   six max and "sounds cooler". The URL slug and the protocol id are
   unaffected, this is display text only. */
export const MODE_NAME: Record<Mode, string> = { 'six-max': '6X', 'heads-up': 'Heads-up' };

/* The name mid-sentence. Every other label here is sentence case, so folding
   it into a lowercase sentence is just `.toLowerCase()`; 6X is a short form,
   not a capitalised word, and lowercasing it spells something else. */
export function modeInline(mode: Mode): string {
  return mode === 'six-max' ? MODE_NAME[mode] : MODE_NAME[mode].toLowerCase();
}

export interface ModeTabsProps {
  mode: Mode;
  onPick: (m: Mode) => void;
  label: string; // what this pair of tabs switches, for a screen reader
}

/* The six-max tab reads as a 6 with MAX running up its side, smaller and
   turned on end rather than sitting next to it as a second word: the tab is
   the one place this gets room to be a wordmark rather than short text. */
function tabLabel(m: Mode): React.ReactNode {
  if (m !== 'six-max') return MODE_NAME[m];
  return (
    <span className="mode-6max">
      6<span className="mode-6max-suffix">MAX</span>
    </span>
  );
}

/* The mode switcher, which is `Segmented` with the modes in it. It used to
   hold its own copy of the tab wiring; there are two switchers on this site
   now and one copy of that wiring is enough, so the co-ownership rules with
   g-ui live in `segmented.tsx` and this is a list of options. */
export function ModeTabs({ mode, onPick, label }: ModeTabsProps) {
  return (
    <Segmented
      options={MODES.map((m) => ({ value: m, label: tabLabel(m) }))}
      value={mode}
      onPick={onPick}
      label={label}
    />
  );
}
