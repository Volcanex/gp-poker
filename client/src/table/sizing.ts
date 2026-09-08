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

/* Ten sizes for a band under a mouse, in two rows of five. Six was too few:
   every postflop size was about the pot and nobody could bet sixty percent of
   it, which is the size the request that added these named. The phone keeps
   the six above, because its sweep can land on any number and its marks are
   only signposts.

   Preflop the sizes people think in are multiples of the bet, so the middle
   eight are 2x through 6x with a pot sized raise as the ninth, which is the
   size a three bet wants. Postflop they are fractions of the pot after the
   call, from a quarter to one and a half. Min and all in are the ends of
   both, so the first and last key always mean the same thing. */
export function presetsWide(
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
          { key: '3.5x', label: '3.5×', value: multiple(3.5) },
          { key: '4x', label: '4×', value: multiple(4) },
          { key: '5x', label: '5×', value: multiple(5) },
          { key: '6x', label: '6×', value: multiple(6) },
          { key: 'pot', label: 'Pot', value: fraction(1) },
        ]
      : [
          { key: 'p25', label: '25%', value: fraction(0.25) },
          { key: 'p33', label: '33%', value: fraction(1 / 3) },
          { key: 'p50', label: '50%', value: fraction(0.5) },
          { key: 'p60', label: '60%', value: fraction(0.6) },
          { key: 'p75', label: '75%', value: fraction(0.75) },
          { key: 'pot', label: '100%', value: fraction(1) },
          { key: 'p125', label: '125%', value: fraction(1.25) },
          { key: 'p150', label: '150%', value: fraction(1.5) },
        ];

  return [
    { key: 'min', label: 'Min', value: min },
    ...middle,
    { key: 'allin', label: 'All in', value: max },
  ];
}

/* Which presets say a number another one already says. A segment sends on one
   press, so two segments sending the same raise is one raise offered twice,
   and the second is disabled rather than dropped so the keys stay put. The
   ends own their numbers: a size that clamps up to the stack is an all in and
   the all in segment is the one that stays, and a size that clamps down to the
   minimum is the minimum. Between them, the first to say a number keeps it. */
export function dupKeys(presets: Preset[]): Set<string> {
  const owner = new Map<number, string>();
  for (const p of presets) if (p.key === 'min' || p.key === 'allin') owner.set(p.value, p.key);
  for (const p of presets) if (!owner.has(p.value)) owner.set(p.value, p.key);
  return new Set(presets.filter((p) => owner.get(p.value) !== p.key).map((p) => p.key));
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
