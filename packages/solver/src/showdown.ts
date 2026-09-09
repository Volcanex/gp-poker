/* Terminal values for a two player subgame, over whole ranges at once.

   The naive way to value a showdown is to compare every one of our combos
   against every one of theirs, which is O(n squared) and is paid at every
   terminal node of every iteration. Instead both ranges are sorted once by
   hand rank on this board, and each evaluation is a single sweep that carries
   a running total of opponent weight plus a per card total, so the weight of
   the hands we beat comes out in constant time per combo with card removal
   handled exactly:

     opponent hands worse than ours and sharing no card with ours
       = (weight of all worse hands) - (worse hands using our first card)
         - (worse hands using our second card)

   The two cards cannot both be shared with a worse hand that is not our own
   combo, and our own combo is never in the accumulated set (it is in the group
   being scored), so no inclusion-exclusion term is left over.

   phe's card codes are `rank * 4 + suit` over the rank order '23456789TJQKA'
   and the suit order 'shdc', which is exactly the numbering in cards.ts, so a
   card index is passed to the evaluator unchanged. */

import { evaluateCardCodes } from 'phe';
import { COMBO_HIGH, COMBO_LOW, NUM_COMBOS, cardBlocked, comboBlocked, deadMask } from './cards.js';
import type { Range } from './range.js';

export interface Universe {
  n: number;
  combos: Int32Array; // combo index of each position
  cardA: Int8Array; // high card of each position
  cardB: Int8Array;
  slot: Int32Array; // combo index -> position, or -1
  scratch: Float32Array;
  cardAcc: Float64Array;
}

/* The combos both players might hold on this board: the union of the two
   ranges, minus anything the board blocks. One shared list keeps every weight
   vector on the same indexing, which is what makes the sweep symmetric. */
export function universeOf(hero: Range, villain: Range, board: number[]): Universe {
  const mask = deadMask(board);
  const combos: number[] = [];
  for (let i = 0; i < NUM_COMBOS; i++) {
    if (hero[i] <= 0 && villain[i] <= 0) continue;
    if (comboBlocked(i, mask)) continue;
    combos.push(i);
  }
  const n = combos.length;
  const slot = new Int32Array(NUM_COMBOS).fill(-1);
  const cardA = new Int8Array(n);
  const cardB = new Int8Array(n);
  for (let p = 0; p < n; p++) {
    const c = combos[p];
    slot[c] = p;
    cardA[p] = COMBO_HIGH[c];
    cardB[p] = COMBO_LOW[c];
  }
  return {
    n,
    combos: Int32Array.from(combos),
    cardA,
    cardB,
    slot,
    scratch: new Float32Array(n),
    cardAcc: new Float64Array(52),
  };
}

export function projectRange(u: Universe, range: Range): Float32Array {
  const out = new Float32Array(u.n);
  for (let p = 0; p < u.n; p++) out[p] = range[u.combos[p]];
  return out;
}

export interface RankedBoard {
  order: Int32Array; // positions, best hand first
  groups: Int32Array; // group start offsets into order, with n as the last entry
}

/* Ranks every combo on a board of three, four or five cards and groups the
   ties. phe ranks are lower-is-better, so ascending order is best first. A
   short board is only ever ranked to read made hand strength off it; a
   subgame's leaves always hand over five.

   A universe built on the flop or the turn still holds combos that use a card
   this board has since run out, and handing the evaluator the same card twice
   makes it read off the end of its tables. Those combos are ranked worse than
   any real hand instead. They are impossible on this runout, so the caller
   zeroes their weight; the rank only has to keep them out of everybody
   else's way. */
const BLOCKED_RANK = 1 << 20;

export function rankBoard(u: Universe, board: number[]): RankedBoard {
  const ranks = new Int32Array(u.n);
  const mask = deadMask(board);
  const hand = [...board, 0, 0];
  const a = board.length;
  const b = a + 1;
  for (let p = 0; p < u.n; p++) {
    if (cardBlocked(u.cardA[p], mask) || cardBlocked(u.cardB[p], mask)) {
      ranks[p] = BLOCKED_RANK;
      continue;
    }
    hand[a] = u.cardA[p];
    hand[b] = u.cardB[p];
    ranks[p] = evaluateCardCodes(hand);
  }
  const order = Int32Array.from({ length: u.n }, (_, i) => i).sort((a, b) => ranks[a] - ranks[b]);
  const groups: number[] = [];
  for (let p = 0; p < u.n; p++) {
    if (p === 0 || ranks[order[p]] !== ranks[order[p - 1]]) groups.push(p);
  }
  groups.push(u.n);
  return { order, groups: Int32Array.from(groups) };
}

/* out[i] += payoff * (weight of opponent hands we beat - weight of hands that
   beat us), ties worth nothing to either side. Card removal is exact. */
export function accumulateShowdown(
  u: Universe,
  ranked: RankedBoard,
  oppW: Float32Array,
  payoff: number,
  out: Float32Array
): void {
  const { order, groups } = ranked;
  const { cardA, cardB, scratch, cardAcc } = u;
  const numGroups = groups.length - 1;

  cardAcc.fill(0);
  let acc = 0;
  for (let g = numGroups - 1; g >= 0; g--) {
    const start = groups[g];
    const end = groups[g + 1];
    for (let p = start; p < end; p++) {
      const i = order[p];
      scratch[i] = acc - cardAcc[cardA[i]] - cardAcc[cardB[i]];
    }
    for (let p = start; p < end; p++) {
      const i = order[p];
      const w = oppW[i];
      if (w === 0) continue;
      acc += w;
      cardAcc[cardA[i]] += w;
      cardAcc[cardB[i]] += w;
    }
  }

  cardAcc.fill(0);
  acc = 0;
  for (let g = 0; g < numGroups; g++) {
    const start = groups[g];
    const end = groups[g + 1];
    for (let p = start; p < end; p++) {
      const i = order[p];
      out[i] += payoff * (scratch[i] - (acc - cardAcc[cardA[i]] - cardAcc[cardB[i]]));
    }
    for (let p = start; p < end; p++) {
      const i = order[p];
      const w = oppW[i];
      if (w === 0) continue;
      acc += w;
      cardAcc[cardA[i]] += w;
      cardAcc[cardB[i]] += w;
    }
  }
}

/* out[i] = payoff * (opponent weight that does not share a card with combo i).
   The combo itself is added back because it is counted in both card totals. */
export function foldValues(u: Universe, oppW: Float32Array, payoff: number, out: Float32Array): void {
  const { cardA, cardB, cardAcc } = u;
  cardAcc.fill(0);
  let total = 0;
  for (let p = 0; p < u.n; p++) {
    const w = oppW[p];
    if (w === 0) continue;
    total += w;
    cardAcc[cardA[p]] += w;
    cardAcc[cardB[p]] += w;
  }
  for (let p = 0; p < u.n; p++) {
    out[p] = payoff * (total - cardAcc[cardA[p]] - cardAcc[cardB[p]] + oppW[p]);
  }
}
