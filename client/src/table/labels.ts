import type { ActionKind, Card } from '@opentable/protocol';

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

export function shortHash(h: string, n = 10): string {
  return h.length > n ? `${h.slice(0, n)}…` : h;
}

export function cardsOf(shown: Record<number, Card[]> | undefined, seat: number): Card[] | null {
  if (!shown) return null;
  return shown[seat] ?? null;
}
