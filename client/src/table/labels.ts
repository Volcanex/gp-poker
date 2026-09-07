import type { ActionKind, Card, MatchFormat } from '@opentable/protocol';

export function actionText(a: ActionKind, v?: number): string {
  switch (a) {
    case 'f': return 'Fold';
    case 'x': return 'Check';
    case 'c': return v ? `Call ${v}` : 'Call';
    case 'b': return v ? `Bet ${v}` : 'Bet';
    case 'r': return v ? `Raise to ${v}` : 'Raise';
    case 'a': return 'All in';
  }
}

export function streetText(s: string): string {
  switch (s) {
    case 'pre': return 'Preflop';
    case 'flop': return 'Flop';
    case 'turn': return 'Turn';
    case 'river': return 'River';
    case 'showdown': return 'Showdown';
    default: return 'Hand over';
  }
}

/* A six-max match runs until one player has every chip, so its format carries
   no hand count and the header does not promise one. */
export function handText(hand: number, hands: number | null): string {
  return hands == null ? `Hand ${hand}` : `Hand ${hand} of ${hands}`;
}

/* The blinds as they stand, and where they are in the schedule when there is
   one. The numbers come from the view, which is the server's word for the
   level in play; only the position in the schedule is derived here. */
export function blindText(format: MatchFormat, blinds: { sb: number; bb: number }, hand: number): string {
  const stakes = `blinds ${blinds.sb}/${blinds.bb}`;
  if (format.levels.length <= 1) return `Blinds ${blinds.sb}/${blinds.bb}`;
  const per = Math.max(1, format.levelHands);
  const level = Math.min(format.levels.length - 1, Math.floor((hand - 1) / per));
  if (level >= format.levels.length - 1) return `Level ${level + 1}, ${stakes}, top level`;
  const left = per - ((hand - 1) % per);
  return `Level ${level + 1}, ${stakes}, next in ${left} ${left === 1 ? 'hand' : 'hands'}`;
}

export function ordinal(n: number): string {
  const teen = n % 100;
  const suffix = teen >= 11 && teen <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}

export function shortHash(h: string, n = 10): string {
  return h.length > n ? `${h.slice(0, n)}…` : h;
}

export function cardsOf(shown: Record<number, Card[]> | undefined, seat: number): Card[] | null {
  if (!shown) return null;
  return shown[seat] ?? null;
}
