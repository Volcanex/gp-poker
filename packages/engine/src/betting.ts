import type { Action, HandState, Legal, SeatState } from './types.js';
import { IllegalAction } from './types.js';
import { dealNextStreet, nextActiveSeatFrom, runOutAndShowdown } from './deal.js';
import { resolveFold, resolveShowdown } from './showdown.js';

export function legal(state: HandState, seatIdx: number): Legal {
  if (state.street === 'done' || state.toAct === null) {
    throw new IllegalAction('hand is done');
  }
  if (state.toAct !== seatIdx) {
    throw new IllegalAction('not this seat\'s turn');
  }
  const seat = state.seats[seatIdx];
  const call = state.currentBet - seat.bet;
  const maxTotal = seat.bet + seat.stack;

  const actions: Legal['actions'] = ['f'];
  actions.push(call <= 0 ? 'x' : 'c');
  if (state.currentBet === 0) {
    actions.push('b');
  } else if (maxTotal > state.currentBet) {
    actions.push('r');
  }
  actions.push('a');

  const min =
    state.currentBet === 0
      ? Math.min(state.minRaise, seat.stack)
      : Math.min(state.currentBet + state.minRaise, maxTotal);

  return { actions, call: Math.max(0, call), min, max: maxTotal };
}

function commit(seat: SeatState, targetTotal: number): void {
  const pay = targetTotal - seat.bet;
  seat.stack -= pay;
  seat.bet = targetTotal;
  seat.committed += pay;
  if (seat.stack <= 0) {
    seat.stack = 0;
    seat.allin = true;
  }
}

/* target is a raise-to/bet-to total strictly greater than currentBet. A raise
   that doesn't cover a full minRaise (an all-in for less) still becomes the
   new currentBet but does not reopen action for seats that already acted. */
function applyAggressive(state: HandState, seatIdx: number, target: number): void {
  const seat = state.seats[seatIdx];
  const increase = state.currentBet === 0 ? target : target - state.currentBet;
  const fullRaise = increase >= state.minRaise;
  commit(seat, target);
  seat.acted = true;
  state.currentBet = target;
  state.lastAggressor = seatIdx;
  if (fullRaise) {
    state.minRaise = increase;
    state.seats.forEach((s, i) => {
      if (i !== seatIdx && !s.folded && !s.allin) s.acted = false;
    });
  }
}

export function apply(state: HandState, seatIdx: number, action: Action): HandState {
  const leg = legal(state, seatIdx);
  if (!leg.actions.includes(action.a)) {
    throw new IllegalAction(`action '${action.a}' is not legal for seat ${seatIdx}`);
  }

  const next: HandState = {
    config: state.config,
    deck: state.deck,
    seats: state.seats.map((s) => ({ ...s, cards: s.cards ? [s.cards[0], s.cards[1]] : null })),
    street: state.street,
    board: [...state.board],
    toAct: state.toAct,
    lastAggressor: state.lastAggressor,
    currentBet: state.currentBet,
    minRaise: state.minRaise,
    actions: [...state.actions],
    seq: state.seq,
    result: null,
  };
  const seat = next.seats[seatIdx];
  let loggedV: number | undefined;

  if (action.a === 'f') {
    seat.folded = true;
    seat.acted = true;
  } else if (action.a === 'x') {
    seat.acted = true;
  } else if (action.a === 'c') {
    // Logged as the price paid this action (what a caller actually put in),
    // not the resulting bet total: the total is already on the felt as the
    // bet everyone is matching, and "Calls 4" is the new fact.
    const target = Math.min(next.currentBet, seat.bet + seat.stack);
    loggedV = target - seat.bet;
    commit(seat, target);
    seat.acted = true;
  } else if (action.a === 'b' || action.a === 'r') {
    if (action.v === undefined || action.v < leg.min || action.v > leg.max) {
      throw new IllegalAction(`amount ${String(action.v)} out of range [${leg.min}, ${leg.max}]`);
    }
    applyAggressive(next, seatIdx, action.v);
    loggedV = action.v;
  } else if (action.a === 'a') {
    // Logged as the resulting total, the same "to" the aggressive branch
    // already carries for a raise: an all-in reached by outbidding the
    // current bet IS that branch, so the two cases share one number.
    const target = seat.bet + seat.stack;
    loggedV = target;
    if (target <= next.currentBet) {
      commit(seat, target);
      seat.acted = true;
    } else {
      applyAggressive(next, seatIdx, target);
    }
  }

  next.actions.push({ s: seatIdx, a: action.a, ...(loggedV !== undefined ? { v: loggedV } : {}), t: 0 });
  next.seq += 1;

  afterAction(next);
  return next;
}

function afterAction(state: HandState): void {
  const n = state.seats.length;
  const nonFolded = state.seats.filter((s) => !s.folded);
  if (nonFolded.length === 1) {
    const winnerIdx = state.seats.findIndex((s) => !s.folded);
    resolveFold(state, winnerIdx);
    state.toAct = null;
    return;
  }

  const canAct = nonFolded.filter((s) => !s.allin);
  if (canAct.length === 0) {
    runOutAndShowdown(state);
    return;
  }

  if (canAct.every((s) => s.acted)) {
    if (state.street === 'river') {
      resolveShowdown(state);
      state.toAct = null;
    } else {
      dealNextStreet(state);
      state.toAct = nextActiveSeatFrom(state, (state.config.button + 1) % n);
    }
    return;
  }

  const cur = state.toAct as number;
  state.toAct = nextActiveSeatFrom(state, (cur + 1) % n);
}
