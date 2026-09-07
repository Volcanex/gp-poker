import type { LegalActions } from '@opentable/protocol';

export interface Preset { label: string; value: number }

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/* Raise-to sizes for the action bar. A fraction is of the pot as it stands
   after the call, added to what the player already has in front of them, which
   is the size everyone means when they say "pot". Everything is clamped to what
   the server said is legal, and duplicates collapse: at short stacks min, pot
   and all in are often the same number, and three buttons that do one thing is
   a way to misclick a stack in. */
export function raisePresets(legal: LegalActions, pot: number, myBet: number): Preset[] {
  const { call, min, max } = legal;
  const potAfterCall = pot + call;
  const to = (f: number) => clamp(Math.round(myBet + call + f * potAfterCall), min, max);
  const all: Preset[] = [
    { label: 'Min', value: min },
    { label: '½ pot', value: to(0.5) },
    { label: '¾ pot', value: to(0.75) },
    { label: 'Pot', value: to(1) },
    { label: 'All in', value: max },
  ];
  const seen = new Set<number>();
  return all.filter((p) => (seen.has(p.value) ? false : (seen.add(p.value), true)));
}
