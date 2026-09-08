import type { Mode } from '@opentable/protocol';
import { Segmented } from './segmented.tsx';

/* Six handed first, everywhere a pair of modes is offered: it is the main
   game now, and a tab strip that opens on the sideshow says otherwise. */
export const MODES: Mode[] = ['six-max', 'heads-up'];
export const MODE_NAME: Record<Mode, string> = { 'six-max': 'Six-max', 'heads-up': 'Heads-up' };

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
