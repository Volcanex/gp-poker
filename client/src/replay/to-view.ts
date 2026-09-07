import type { HandState } from '@opentable/engine';
import { visibleCards } from '@opentable/engine';
import type { Card, SeatView, TableView } from '@opentable/protocol';
import type { Hand } from '../net/types.ts';

/* A replayed HandState rendered through the same table components a live match
   uses. The engine's state carries everything the view needs except the names,
   which come from the hand row. Rating is 0 here: a hand row does not record
   what the players were rated at the time, and a made-up number beside a name
   is worse than no number, so the seat hides it. */
export function stateToView(hand: Hand, state: HandState, step: number, showAll: boolean): TableView {
  const visible = visibleCards(state, null);
  const lastBySeat = lastActions(hand, step);

  const seats: SeatView[] = state.seats.map((s, i) => ({
    i,
    uid: hand.seats[i]?.userId ?? String(i),
    name: hand.seats[i]?.name ?? `Seat ${i}`,
    rating: 0,
    stack: s.stack,
    bet: s.bet,
    cards: showAll ? (s.cards as Card[] | null) : visible[i],
    folded: s.folded,
    allin: s.allin,
    button: i === state.config.button,
    acting: state.toAct === i,
    connected: true,
    last: lastBySeat[i] ?? null,
  }));

  return {
    m: hand.matchId,
    h: hand.number,
    n: state.seq,
    street: state.street,
    board: state.board,
    pot: state.seats.reduce((sum, s) => sum + s.committed, 0),
    pots: state.result ? state.result.pots.map((p) => ({ amount: p.amount, seats: p.eligible })) : [],
    seats,
    you: null,
    legal: null,
    clock: null,
    seedHash: hand.seedHash,
    seed: hand.seed,
    format: { hands: 0, stack: hand.stacksStart[0] ?? 0, sb: hand.sb, bb: hand.bb, clockMs: 0, graceMs: 0 },
    handsPlayed: hand.number - 1,
    last: null,
    result: state.result ? { awards: state.result.awards, shown: state.result.shown } : null,
  };
}

type LastAction = NonNullable<SeatView['last']>;

function lastActions(hand: Hand, step: number): Record<number, LastAction> {
  const out: Record<number, LastAction> = {};
  for (let i = 0; i < step; i += 1) {
    const a = hand.actions[i];
    if (!a) break;
    out[a.s] = a.v === undefined ? { a: a.a } : { a: a.a, v: a.v };
  }
  return out;
}
