/* Ranges as sets of the 169 hand classes ('AA', 'AKs', 'AKo'), the notation that
   reads and writes them, and the concrete card combinations a class expands to.

   Weights are deliberately absent: a class is in a range or it is not. Anything
   that needs a mixed strategy needs a solver, and this package is explicit about
   not being one. */

import type { Card } from '@opentable/protocol';
import { SUIT_CHARS } from './cards.js';
import { percentileOfClass, rankedClasses } from './ranking.js';

export type Range = Set<string>;

export const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'] as const;

/* Combinations each kind of class holds, and the 1326 two card hands in a deck.
   A range's size in combos is what matters when you compare two ranges: sixteen
   offsuit classes are not the same amount of poker as sixteen pairs. */
export const RANGE_SIZE = { pair: 6, suited: 4, offsuit: 12, total: 1326 } as const;

/* Pairs down the diagonal, suited above it, offsuit below, AA top left: the
   layout every poker chart uses, so the grid can be rendered straight from it. */
export const HAND_GRID: string[][] = RANKS.map((hi, i) =>
  RANKS.map((lo, j) => {
    if (i === j) return `${hi}${hi}`;
    return i < j ? `${hi}${lo}s` : `${lo}${hi}o`;
  }),
);

export const ALL_CLASSES: string[] = HAND_GRID.flat().filter((c, i, all) => all.indexOf(c) === i);

function rankIndex(ch: string): number {
  const i = (RANKS as readonly string[]).indexOf(ch.toUpperCase());
  if (i < 0) throw new Error(`not a rank: ${ch}`);
  return i;
}

export function classKind(cls: string): 'pair' | 'suited' | 'offsuit' {
  if (cls.length === 2) return 'pair';
  return cls[2] === 's' ? 'suited' : 'offsuit';
}

export function comboCount(range: Range): number {
  let total = 0;
  for (const cls of range) total += RANGE_SIZE[classKind(cls)];
  return total;
}

/* Percent of all starting hands, by combinations rather than by class count. */
export function rangePercent(range: Range): number {
  return (comboCount(range) / RANGE_SIZE.total) * 100;
}

function classOf(hi: number, lo: number, suited: boolean): string {
  if (hi === lo) return `${RANKS[hi]}${RANKS[hi]}`;
  const [a, b] = hi < lo ? [hi, lo] : [lo, hi];
  return `${RANKS[a]}${RANKS[b]}${suited ? 's' : 'o'}`;
}

interface Token {
  hi: number;
  lo: number;
  kinds: ('s' | 'o')[]; // empty for a pair
}

function readClass(text: string): Token {
  const t = text.trim();
  const m = /^([2-9tjqkaTJQKA])([2-9tjqkaTJQKA])([so])?$/.exec(t);
  if (!m) throw new Error(`cannot read "${text}" as a hand`);
  const a = rankIndex(m[1]);
  const b = rankIndex(m[2]);
  const hi = Math.min(a, b);
  const lo = Math.max(a, b);
  if (hi === lo) {
    if (m[3]) throw new Error(`a pair cannot be suited or offsuit: "${text}"`);
    return { hi, lo, kinds: [] };
  }
  const suffix = m[3]?.toLowerCase() as 's' | 'o' | undefined;
  return { hi, lo, kinds: suffix ? [suffix] : ['s', 'o'] };
}

function add(range: Range, hi: number, lo: number, kinds: ('s' | 'o')[]): void {
  if (hi === lo) {
    range.add(classOf(hi, lo, false));
    return;
  }
  for (const k of kinds) range.add(classOf(hi, lo, k === 's'));
}

/* Standard notation, case insensitive, comma or space separated:
   "AA, KK, AKs, AQo+, 22+, T9s-65s, A2s+, KTo+". A bare "AK" means both suited
   and offsuit. "+" walks up: pairs to AA, kickers to one below the top card.
   A dash walks between two hands of the same shape: same top card ("AJo-A8o"),
   same gap ("T9s-65s"), or pairs ("99-66"). */
export function parseRange(text: string): Range {
  const range: Range = new Set();
  for (const raw of text.split(/[,\s]+/)) {
    const token = raw.trim();
    if (!token) continue;

    if (token.includes('-')) {
      const [fromText, toText] = token.split('-');
      const from = readClass(fromText);
      const to = readClass(toText);
      const sameShape =
        (from.hi === from.lo) === (to.hi === to.lo) &&
        from.kinds.join('') === to.kinds.join('');
      if (!sameShape) throw new Error(`"${token}" joins two different kinds of hand`);
      const [top, bottom] = from.hi <= to.hi ? [from, to] : [to, from];
      if (top.hi === top.lo) {
        for (let r = top.hi; r <= bottom.hi; r++) add(range, r, r, []);
      } else if (top.hi === bottom.hi) {
        for (let lo = top.lo; lo <= bottom.lo; lo++) add(range, top.hi, lo, top.kinds);
      } else if (top.lo - top.hi === bottom.lo - bottom.hi) {
        const gap = top.lo - top.hi;
        for (let hi = top.hi; hi <= bottom.hi; hi++) add(range, hi, hi + gap, top.kinds);
      } else {
        throw new Error(`"${token}" is not a run: the hands share neither a top card nor a gap`);
      }
      continue;
    }

    if (token.endsWith('+')) {
      const base = readClass(token.slice(0, -1));
      if (base.hi === base.lo) {
        for (let r = 0; r <= base.hi; r++) add(range, r, r, []);
      } else {
        for (let lo = base.hi + 1; lo <= base.lo; lo++) add(range, base.hi, lo, base.kinds);
      }
      continue;
    }

    const base = readClass(token);
    add(range, base.hi, base.lo, base.kinds);
  }
  return range;
}

function runsOf(indices: number[]): [number, number][] {
  const sorted = [...indices].sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (const i of sorted) {
    const last = runs[runs.length - 1];
    if (last && i === last[1] + 1) last[1] = i;
    else runs.push([i, i]);
  }
  return runs;
}

/* Compact canonical notation, and the only shapes this emits are "+", a dash
   between two hands with the same top card, and single hands, so parseRange
   round trips it exactly. */
export function rangeToText(range: Range): string {
  const parts: string[] = [];

  const pairs = [...range].filter((c) => classKind(c) === 'pair').map((c) => rankIndex(c[0]));
  for (const [top, bottom] of runsOf(pairs)) {
    const lowest = `${RANKS[bottom]}${RANKS[bottom]}`;
    if (top === 0 && bottom > top) parts.push(`${lowest}+`);
    else if (top === bottom) parts.push(lowest);
    else parts.push(`${RANKS[top]}${RANKS[top]}-${lowest}`);
  }

  for (const suffix of ['s', 'o'] as const) {
    for (let hi = 0; hi < RANKS.length; hi++) {
      const kickers = [...range]
        .filter((c) => classKind(c) !== 'pair' && c[2] === suffix && rankIndex(c[0]) === hi)
        .map((c) => rankIndex(c[1]));
      for (const [top, bottom] of runsOf(kickers)) {
        const low = `${RANKS[hi]}${RANKS[bottom]}${suffix}`;
        if (top === hi + 1 && bottom > top) parts.push(`${low}+`);
        else if (top === bottom) parts.push(low);
        else parts.push(`${RANKS[hi]}${RANKS[top]}${suffix}-${low}`);
      }
    }
  }

  return parts.join(', ');
}

/* The top slice of the heads-up equity ranking, by percentile: rangeFromTop(20)
   is every class in the best 20 percent of the 169, not the best 20 percent of
   the 1326 combinations. Classes, not combos, is what a chart is drawn in. */
export function rangeFromTop(percent: number): Range {
  const range: Range = new Set();
  for (const [cls] of rankedClasses()) {
    if (percentileOfClass(cls) < percent) range.add(cls);
  }
  return range;
}

/* Every concrete two card holding in the range that no dead card blocks. */
export function combosOf(range: Range, dead: Card[] = []): [Card, Card][] {
  const blocked = new Set(dead);
  const out: [Card, Card][] = [];
  for (const cls of ALL_CLASSES) {
    if (!range.has(cls)) continue;
    const kind = classKind(cls);
    if (kind === 'pair') {
      for (let i = 0; i < SUIT_CHARS.length; i++) {
        for (let j = i + 1; j < SUIT_CHARS.length; j++) {
          const combo: [Card, Card] = [`${cls[0]}${SUIT_CHARS[i]}`, `${cls[0]}${SUIT_CHARS[j]}`];
          if (!blocked.has(combo[0]) && !blocked.has(combo[1])) out.push(combo);
        }
      }
    } else if (kind === 'suited') {
      for (const s of SUIT_CHARS) {
        const combo: [Card, Card] = [`${cls[0]}${s}`, `${cls[1]}${s}`];
        if (!blocked.has(combo[0]) && !blocked.has(combo[1])) out.push(combo);
      }
    } else {
      for (const a of SUIT_CHARS) {
        for (const b of SUIT_CHARS) {
          if (a === b) continue;
          const combo: [Card, Card] = [`${cls[0]}${a}`, `${cls[1]}${b}`];
          if (!blocked.has(combo[0]) && !blocked.has(combo[1])) out.push(combo);
        }
      }
    }
  }
  return out;
}

/* The class a concrete holding belongs to, so a picked hand can be looked up in
   the grid or the ranking. */
export function classOfCards(cards: [Card, Card]): string {
  const a = rankIndex(cards[0][0]);
  const b = rankIndex(cards[1][0]);
  if (a === b) return classOf(a, b, false);
  return classOf(a, b, cards[0][1] === cards[1][1]);
}
