import type { ActionKind, LegalActions, Street } from '@opentable/protocol';

export interface Preset {
  key: string; // stable across states, so the number keys always mean the same thing
  label: string; // the name of the size
  value: number; // the raise-to total it writes into the field
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/* Raise-to sizes for **v1's dock**, which is the only thing left that uses
   them; the band's own six are `presetsStack` below. A fraction is of the pot
   as it stands after the call, added to what the player already has in front of them, which is the
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

/* The band's six, and the only sizes it offers. **They are fractions of what
   the player has, not of the pot**, which is what the owner asked for: a
   spread up the stack rather than ten pot fractions nobody could tell apart.
   `legal.max` is the raise-to that puts the whole stack in (the engine's
   `seat.bet + seat.stack`), so a fraction of it is a fraction of what they
   have, and the all in slot is the top of the same ladder rather than a
   number of its own.

   The same six before the flop and after it. The old set changed shape at the
   flop, which meant the key under a finger meant one thing preflop and
   another on the turn, and every postflop size was about the pot.

   Six slots, always the same six in the same order, because the number keys
   address them by position: a preset that moves is a preset nobody learns.
   Everything is rounded to a whole chip and clamped into the legal range, so
   a short stack collapses the middle of the ladder rather than offering a
   size the server would refuse. */
export const STACK_FRACTIONS = [0.1, 0.25, 0.5, 0.75] as const;

/* Which slot a size of your own starts from. The quarter, because it is the
   size a player who reaches for the sizer is usually somewhere near, and
   because the sweep and the typed field should open on the same number.

   **A decision itself opens on Min, not on this**, which is the rule the dock
   has always had: the loaded size is what Enter and the button send, and a
   band that came up preflop holding a quarter of a stack is a stack lost to a
   keypress nobody meant. The quarter is a place to sweep from, not a place to
   land. */
export const DEFAULT_PRESET = 2;

/* And which slot the sizer actually starts from when a short stack has
   collapsed the quarter onto a neighbour. A blank box is not a size anyone can
   choose, so it steps up the ladder to the first live box above it, and falls
   back down to the first live box at all when there is none. */
export function openAt(presets: Preset[], dups: ReadonlySet<string>): number {
  const live = (i: number) => presets[i] != null && !dups.has(presets[i].key);
  for (let i = DEFAULT_PRESET; i < presets.length; i += 1) if (live(i)) return i;
  for (let i = 0; i < presets.length; i += 1) if (live(i)) return i;
  return 0;
}

export function presetsStack(legal: LegalActions): Preset[] {
  const { min, max } = legal;
  if (max <= 0 || max < min) return [];
  const of = (f: number) => clamp(Math.round(f * max), min, max);
  return [
    { key: 'min', label: 'Min', value: min },
    ...STACK_FRACTIONS.map((f) => ({
      key: `s${Math.round(f * 100)}`,
      label: `${Math.round(f * 100)}%`,
      value: of(f),
    })),
    { key: 'allin', label: 'All in', value: max },
  ];
}

/* Which presets say a number another one already says. A short stack collapses
   the middle of the ladder onto its ends, and a box repeating a number its
   neighbour already offers is noise, so the later one is drawn blank and
   disabled rather than dropped: the keys address the boxes by position and a
   box that moved would take its key with it. The ends own their numbers, which
   is why the all in box is always the last one and always says the stack: a
   size that clamps up to the stack is an all in, a size that clamps down to
   the minimum is the minimum, and between them the first to say a number keeps
   it. */
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
