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

/* The mode switcher, which is `Segmented` with the modes in it. It used to
   hold its own copy of the tab wiring; there are two switchers on this site
   now and one copy of that wiring is enough, so the co-ownership rules with
   g-ui live in `segmented.tsx` and this is a list of options. */
export function ModeTabs({ mode, onPick, label }: ModeTabsProps) {
  return (
    <Segmented
      options={MODES.map((m) => ({ value: m, label: MODE_NAME[m] }))}
      value={mode}
      onPick={onPick}
      label={label}
    />
  );
}
