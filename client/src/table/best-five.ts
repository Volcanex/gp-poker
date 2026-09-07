import type { Card } from '@opentable/protocol';

/* Which five cards actually made the hand, so the showdown can outline them and
   dim the rest of the board.

   The engine already knows this, but it knows it through `phe`, whose lookup
   table is the reason the replay route is lazy-loaded. Pulling that into the
   table would put 80 kB gzipped back into the bundle everyone loads to play,
   so the five are picked here instead: 21 combinations, scored by category and
   kickers, no table. The unit test pins it against the hand names the engine
   sends down beside the award. */

const ORDER = '23456789TJQKA';

const rankOf = (c: Card): number => ORDER.indexOf(c[0]) + 2;

interface Shape {
  category: number;
  tie: number[];
}

/* Category, then the ranks that break the tie. */
function shapeOf(five: Card[]): Shape {
  const ranks = five.map(rankOf).sort((a, b) => b - a);
  const suit = five[0][1];
  const flush = five.every((c) => c[1] === suit);

  const distinct = [...new Set(ranks)];
  let straight = 0;
  if (distinct.length === 5) {
    if (distinct[0] - distinct[4] === 4) straight = distinct[0];
    else if (distinct[0] === 14 && distinct[1] === 5) straight = 5; // the wheel
  }

  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const shape = groups.map((g) => g[1]).join('');

  let category: number;
  if (flush && straight) category = 8;
  else if (shape === '41') category = 7;
  else if (shape === '32') category = 6;
  else if (flush) category = 5;
  else if (straight) category = 4;
  else if (shape === '311') category = 3;
  else if (shape === '221') category = 2;
  else if (shape === '2111') category = 1;
  else category = 0;

  const tie = category === 4 || category === 8 ? [straight] : groups.map((g) => g[0]);
  return { category, tie };
}

/* One comparable number. Base 15 leaves room for an ace at 14 in every slot. */
function score(five: Card[]): number {
  const { category, tie } = shapeOf(five);
  let n = category;
  for (let i = 0; i < 5; i += 1) n = n * 15 + (tie[i] ?? 0);
  return n;
}

const CATEGORY_NAMES = [
  'high card', 'one pair', 'two pair', 'three of a kind', 'straight',
  'flush', 'full house', 'four of a kind', 'straight flush',
];

/* What to call a hand beside the seat that showed it. The engine sends the
   winner's description with the award, so this names the hands it does not
   send one for: the losers at a showdown, who are the reason you can read the
   board at all. No kickers, because the seat has room for two words. */
export function handCategory(five: Card[]): string {
  if (five.length !== 5) return '';
  return CATEGORY_NAMES[shapeOf(five).category];
}

/* The best five of up to seven, in the order they were handed in so the caller
   can match them back to the cards on screen. Fewer than five cards has no
   answer and gives none. */
export function bestFive(cards: Card[]): Card[] {
  const usable = cards.filter((c) => c != null && c.length === 2 && ORDER.includes(c[0]));
  if (usable.length < 5) return [];
  if (usable.length === 5) return usable;

  let best: Card[] = [];
  let bestScore = -1;
  const n = usable.length;
  const pick: Card[] = [];
  const walk = (start: number) => {
    if (pick.length === 5) {
      const s = score(pick);
      if (s > bestScore) {
        bestScore = s;
        best = [...pick];
      }
      return;
    }
    for (let i = start; i < n; i += 1) {
      pick.push(usable[i]);
      walk(i + 1);
      pick.pop();
    }
  };
  walk(0);
  return best;
}
