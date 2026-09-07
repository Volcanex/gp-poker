import type { SeatState, Pot } from './types.js';

function sameSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  return sa.every((v, i) => v === sb[i]);
}

/* Peel layers from the lowest common committed amount up. Folded seats still
   contribute their committed chips to every layer they reached but are never
   eligible to win it; a layer nobody is eligible for rolls forward into the
   next one that is. Consecutive layers with identical eligible sets are
   merged into one pot. */
export function buildPots(seats: SeatState[]): Pot[] {
  const remaining = seats.map((s) => s.committed);
  const raw: Pot[] = [];
  let carry = 0;
  while (remaining.some((r) => r > 0)) {
    const layerIdxs: number[] = [];
    for (let i = 0; i < remaining.length; i++) if (remaining[i] > 0) layerIdxs.push(i);
    const m = Math.min(...layerIdxs.map((i) => remaining[i]));
    const amount = m * layerIdxs.length;
    const eligible = layerIdxs.filter((i) => !seats[i].folded);
    for (const i of layerIdxs) remaining[i] -= m;
    if (eligible.length === 0) {
      carry += amount;
    } else {
      raw.push({ amount: amount + carry, eligible });
      carry = 0;
    }
  }
  if (carry > 0 && raw.length > 0) raw[raw.length - 1].amount += carry;

  const merged: Pot[] = [];
  for (const p of raw) {
    const last = merged[merged.length - 1];
    if (last && sameSet(last.eligible, p.eligible)) {
      last.amount += p.amount;
    } else {
      merged.push({ amount: p.amount, eligible: [...p.eligible] });
    }
  }
  return merged;
}

/* Winners ordered starting from the seat left of the button, wrapping. Used
   to give the odd chip(s) to the first eligible winner in that order. */
export function orderFromButton(button: number, n: number, idxs: number[]): number[] {
  return [...idxs].sort((a, b) => {
    const da = (a - button - 1 + n) % n;
    const db = (b - button - 1 + n) % n;
    return da - db;
  });
}
