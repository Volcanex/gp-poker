import type { HandState } from '@opentable/engine';
import { visibleCards } from '@opentable/engine';
import type { Card, SeatView, TableView } from '@opentable/protocol';
import type { Hand } from '../net/types.ts';
import { seatIsBot } from '../net/adapt.ts';

/* A replayed HandState rendered through the same table components a live match
   uses. The engine's state carries everything the view needs except the names,
   which come from the hand row. Rating is 0 here: a hand row does not record
   what the players were rated at the time, and a made-up number beside a name
   is worse than no number, so the seat hides it.

   `seatMap` turns an engine seat index into the table seat it was sitting in,
   which is how a hand dealt to four of a six-max table lands back in the right
   chairs. The recorded actions and holes are already in table seats. Without a
   map the two are the same thing, which is every heads-up hand ever written. */
export function stateToView(
  hand: Hand,
  state: HandState,
  step: number,
  showAll: boolean,
  seatMap?: number[],
): TableView {
  const map = seatMap ?? state.seats.map((_, i) => i);
  const visible = visibleCards(state, null);
  const lastBySeat = lastActions(hand, step);

  const seats: SeatView[] = state.seats.map((s, i) => {
    const at = map[i] ?? i;
    const row = hand.seats.find((x) => x.seat === at) ?? hand.seats[i];
    return {
      i: at,
      uid: row?.userId ?? String(at),
      name: row?.name ?? `Seat ${at}`,
      rating: 0,
      stack: s.stack,
      bet: s.bet,
      cards: showAll ? (s.cards as Card[] | null) : visible[i],
      folded: s.folded,
      allin: s.allin,
      /* Straight off the state the engine built, the same fact the live
         server puts on the wire, so a replayed hand marks the blinds without
         either side counting round from the button on its own. */
      ...(i === state.blinds.sb ? { blind: 'sb' as const } : {}),
      ...(i === state.blinds.bb ? { blind: 'bb' as const } : {}),
      button: i === state.config.button,
      acting: state.toAct === i,
      connected: true,
      bot: row ? seatIsBot(row) : false,
      out: false,
      place: null,
      last: lastBySeat[at] ?? null,
    };
  });

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
    /* The hand row records the blinds it was dealt at and nothing about the
       match around it, so the format here says only what this hand knows. The
       replay draws the felt bare, without the header that would read it. */
    format: {
      mode: state.seats.length > 2 ? 'six-max' : 'heads-up',
      players: hand.seats.length,
      rated: false,
      hands: null,
      stack: hand.stacksStart[0] ?? 0,
      sb: hand.sb,
      bb: hand.bb,
      levels: [{ sb: hand.sb, bb: hand.bb }],
      levelHands: 0,
      clockMs: 0,
      graceMs: 0,
    },
    blinds: { sb: hand.sb, bb: hand.bb },
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
