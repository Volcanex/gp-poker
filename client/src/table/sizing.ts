import type { ActionKind, LegalActions, Street } from '@opentable/protocol';

export interface Preset {
  key: string; // stable across states, so the number keys always mean the same thing
  label: string; // the name of the size
  value: number; // the raise-to total it writes into the field
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/* Raise-to sizes for the dock. A fraction is of the pot as it stands after the
   call, added to what the player already has in front of them, which is the
   size everyone means when they say "pot". Everything is clamped to what the
   server said is legal.

   Six slots, always the same six in the same order, because the number keys
   address them and a preset that moves is a preset nobody learns. Duplicates
   are no longer collapsed the way they were when a preset sent the action:
   a preset now only writes a number into the field, and the button underneath
   says what will be sent, so two slots landing on the same number cannot cost
   anyone a stack.

   Preflop the sizes people think in are multiples of the bet, not fractions of
   the pot, so the middle four become 2x, 2.5x and 3x the current bet. */
export function presetsFor(
  legal: LegalActions,
  pot: number,
  myBet: number,
  street: Street,
): Preset[] {
  const { call, min, max } = legal;
  if (max <= 0 || max < min) return [];

  const potAfterCall = pot + call;
  const currentBet = myBet + call;
  const fraction = (f: number) => clamp(Math.round(myBet + call + f * potAfterCall), min, max);
  const multiple = (x: number) => clamp(Math.round(currentBet * x), min, max);

  const middle: Preset[] =
    street === 'pre'
      ? [
          { key: '2x', label: '2×', value: multiple(2) },
          { key: '2.5x', label: '2.5×', value: multiple(2.5) },
          { key: '3x', label: '3×', value: multiple(3) },
        ]
      : [
          { key: 'third', label: '⅓', value: fraction(1 / 3) },
          { key: 'half', label: '½', value: fraction(0.5) },
          { key: 'twothirds', label: '⅔', value: fraction(2 / 3) },
        ];

  return [
    { key: 'min', label: 'Min', value: min },
    ...middle,
    { key: 'pot', label: 'Pot', value: fraction(1) },
    { key: 'allin', label: 'All in', value: max },
  ];
}

/* What the primary button on a turn does, read off `legal` in one place. The
   dock and the phone's hero band both draw a "raise to" control and both have
   to agree on three things: whether raising is even on the table, whether the
   word is bet or raise, and whether the top of the range is an all in of its
   own. */
export interface RaiseShape {
  canRaise: boolean;
  isBet: boolean;
  kind: ActionKind; // 'b' or 'r', the action a sized raise sends
  checkOrCall: ActionKind | null;
}

export function raiseShape(legal: LegalActions): RaiseShape {
  const { actions, min, max } = legal;
  const canRaise = (actions.includes('b') || actions.includes('r') || actions.includes('a')) && max > min;
  const kind: ActionKind = actions.includes('b') ? 'b' : 'r';
  return {
    canRaise,
    isBet: kind === 'b',
    kind,
    checkOrCall: actions.includes('x') ? 'x' : actions.includes('c') ? 'c' : null,
  };
}

/* At the top of the range an all in is its own action, so a table that offers
   one sends it rather than a raise that happens to be everything. */
export function raiseAction(legal: LegalActions, value: number): { kind: ActionKind; value?: number } {
  const v = clamp(Math.round(value), legal.min, legal.max);
  if (v >= legal.max && legal.actions.includes('a')) return { kind: 'a' };
  return { kind: raiseShape(legal).kind, value: v };
}

/* The button prints the number it will send. */
export function raiseLabel(legal: LegalActions, value: number): string {
  const v = clamp(Math.round(value), legal.min, legal.max);
  if (v >= legal.max) return `All in ${legal.max}`;
  return raiseShape(legal).isBet ? `Bet ${v}` : `Raise to ${v}`;
}
