import { evaluateCards, handRank, rankDescription } from 'phe';
import type { Card } from '@opentable/protocol';
import type { HandState } from './types.js';
import { buildPots, orderFromButton } from './pots.js';

/* Everyone but one seat folded: award them everything committed, board may
   be incomplete, nothing is revealed. */
export function resolveFold(state: HandState, winnerIdx: number): void {
  const total = state.seats.reduce((sum, s) => sum + s.committed, 0);
  state.seats[winnerIdx].stack += total;
  state.street = 'done';
  state.result = {
    pots: [{ amount: total, eligible: [winnerIdx] }],
    awards: [{ seat: winnerIdx, amount: total }],
    shown: {},
  };
}

/* River is complete (dealt to fully, whether by action or all-in run-out):
   build side pots, evaluate every non-folded hand, split each pot among its
   best eligible hand(s), odd chips to the first winner left of the button. */
export function resolveShowdown(state: HandState): void {
  const pots = buildPots(state.seats);
  const n = state.seats.length;
  const button = state.config.button;

  const rank: Record<number, number> = {};
  const desc: Record<number, string> = {};
  state.seats.forEach((s, i) => {
    if (s.folded || !s.cards) return;
    const cards: Card[] = [...s.cards, ...state.board];
    const value = evaluateCards(cards);
    rank[i] = value;
    desc[i] = rankDescription[handRank(value)];
  });

  const totals: Record<number, number> = {};
  for (const pot of pots) {
    if (pot.eligible.length === 0) continue;
    const best = Math.min(...pot.eligible.map((i) => rank[i]));
    const winners = pot.eligible.filter((i) => rank[i] === best);
    const ordered = orderFromButton(button, n, winners);
    const base = Math.floor(pot.amount / ordered.length);
    const remainder = pot.amount % ordered.length;
    ordered.forEach((i, k) => {
      totals[i] = (totals[i] ?? 0) + base + (k < remainder ? 1 : 0);
    });
  }

  for (const key of Object.keys(totals)) {
    const i = Number(key);
    state.seats[i].stack += totals[i];
  }

  const shown: Record<number, [Card, Card]> = {};
  state.seats.forEach((s, i) => {
    if (!s.folded && s.cards) shown[i] = s.cards;
  });

  const awards = Object.keys(totals)
    .map(Number)
    .sort((a, b) => a - b)
    .map((seat) => ({ seat, amount: totals[seat], hand: desc[seat] }));

  state.street = 'done';
  state.result = { pots, awards, shown };
}
