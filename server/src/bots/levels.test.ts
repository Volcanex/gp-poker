import { describe, expect, it } from 'vitest';
import { apply, createHand, legal, type HandState } from '@opentable/engine';
import { formatFor } from '@opentable/protocol';
import type { ActionKind, BotLevel, Card, SeatView, TableView } from '@opentable/protocol';
import { decide, type Rng } from './strategy.js';

/* Proof that the five levels are ordered. Nothing here talks to a database,
   a room or a socket: it deals hands with the engine, builds the same
   TableView a client would see for whoever is to act, asks `decide` for that
   seat's level and applies the answer. What comes out is chips won.

   Two things keep the sample honest at a size that still runs in seconds.
   Every pair of levels plays every other pair (a round robin), so no level's
   total is one lucky matchup; and every deal is played twice with the seats
   swapped, so both levels play the same two hands from the same seat and a
   run of aces cancels out instead of deciding the result. Stacks reset to the
   same number every hand, which measures the strategy rather than who
   happened to bust first. */

const LEVELS: BotLevel[] = [1, 2, 3, 4, 5];
const SEEDS = 500; // deals per pair, each played four times (see roundRobin)
// Thirty big blinds rather than the product's hundred. The strategies are the
// same either way, but the biggest pot a hand can lose is a third the size, so
// the gaps between neighbouring levels clear the noise in a sample this test
// can afford to run.
const STACK = 60;
const SB = 1;
const BB = 2;
const FORMAT = formatFor('heads-up', false);

function mulberry32(seed: number): Rng {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFrom(rng: Rng): string {
  let s = '';
  for (let i = 0; i < 32; i++) s += Math.floor(rng() * 256).toString(16).padStart(2, '0');
  return s;
}

// The same shape server/src/match/handRunner.ts builds, minus everything the
// strategy does not read: a two-seat hand needs no engine-to-table seat map.
function viewOf(state: HandState, seat: number): TableView {
  const pot = state.seats.reduce((sum, s) => sum + s.committed, 0);
  const seats: SeatView[] = state.seats.map((s, i) => {
    let last: { a: ActionKind; v?: number } | null = null;
    for (let j = state.actions.length - 1; j >= 0; j--) {
      if (state.actions[j].s === i) {
        last = { a: state.actions[j].a, v: state.actions[j].v };
        break;
      }
    }
    return {
      i,
      uid: `s${i}`,
      name: `s${i}`,
      rating: 1500,
      stack: s.stack,
      bet: s.bet,
      cards: s.cards === null ? null : i === seat ? ([...s.cards] as Card[]) : (['?', '?'] as Card[]),
      folded: s.folded,
      allin: s.allin,
      button: i === state.config.button,
      acting: state.toAct === i,
      connected: true,
      bot: true,
      out: false,
      place: null,
      last,
    };
  });
  const l = legal(state, seat);
  return {
    m: 'sim',
    h: 1,
    n: state.seq,
    street: state.street,
    board: state.board,
    pot,
    pots: [],
    seats,
    you: seat,
    legal: { actions: l.actions, call: l.call, min: l.min, max: l.max },
    clock: null,
    seedHash: '',
    seed: null,
    format: FORMAT,
    blinds: { sb: state.config.sb, bb: state.config.bb },
    handsPlayed: 0,
    last: null,
    result: null,
  };
}

// One deal, played to the end by the two levels given. Returns the chips each
// seat won or lost against the stack it sat down with.
function playHand(levels: [BotLevel, BotLevel], seed: string, button: number, rng: Rng): [number, number] {
  let state = createHand({
    seats: [
      { id: 's0', stack: STACK },
      { id: 's1', stack: STACK },
    ],
    button,
    sb: SB,
    bb: BB,
    seed,
  });

  // The engine ends a hand in a bounded number of actions; the guard is here
  // so a strategy bug is a failed assertion rather than a hung suite.
  for (let step = 0; state.street !== 'done' && step < 400; step++) {
    const seat = state.toAct;
    if (seat === null) break;
    const decision = decide(viewOf(state, seat), rng, levels[seat]);
    state = apply(state, seat, decision.v !== undefined ? { a: decision.a, v: decision.v } : { a: decision.a });
  }
  expect(state.street).toBe('done');
  return [state.seats[0].stack - STACK, state.seats[1].stack - STACK];
}

function roundRobin(): Map<BotLevel, number> {
  const chips = new Map<BotLevel, number>(LEVELS.map((l) => [l, 0]));
  for (let a = 0; a < LEVELS.length; a++) {
    for (let b = a + 1; b < LEVELS.length; b++) {
      const [low, high] = [LEVELS[a], LEVELS[b]];
      // One rng per matchup, seeded from the pair, so a matchup's result does
      // not depend on how many hands the matchups before it happened to use.
      const rng = mulberry32(1000 * low + high);
      for (let s = 0; s < SEEDS; s++) {
        const seed = seedFrom(rng);
        // Every deal is played four times: both seatings, both buttons. Each
        // level therefore holds both hands from both positions, so a run of
        // aces or of dealer buttons cancels instead of deciding the result.
        // The two seatings of one deal share a decision stream from the same
        // starting state rather than taking two halves of one, which leaves
        // only the places where the levels actually decide differently. That
        // is the whole signal; without it the variance drowns the gaps.
        for (const button of [0, 1]) {
          const draw = 7_000_003 * low + 101 * high + 2 * s + button;
          const first = playHand([low, high], seed, button, mulberry32(draw));
          const second = playHand([high, low], seed, button, mulberry32(draw));
          chips.set(low, chips.get(low)! + first[0] + second[1]);
          chips.set(high, chips.get(high)! + first[1] + second[0]);
        }
      }
    }
  }
  return chips;
}

describe('bot levels', () => {
  it(
    'orders the five levels by chips won in a seeded round robin',
    () => {
      const chips = roundRobin();
      const perLevel = LEVELS.map((l) => ({ level: l, chips: chips.get(l)! }));
      // Printed because a failure here is a tuning question, and the margins
      // are the answer to it.
      console.log(perLevel.map((p) => `L${p.level} ${p.chips > 0 ? '+' : ''}${p.chips}`).join('  '));

      // Every observed gap over a spread of seeds is at least twice this, and
      // the noise on one level's total is well under it: a level that has not
      // actually improved cannot clear it by luck.
      const margin = 1000;
      for (let i = 1; i < perLevel.length; i++) {
        expect(perLevel[i].chips).toBeGreaterThan(perLevel[i - 1].chips + margin);
      }
    },
    60_000
  );

  it('leaves level 4 as the default', () => {
    const rng = mulberry32(7);
    const state = createHand({
      seats: [
        { id: 's0', stack: STACK },
        { id: 's1', stack: STACK },
      ],
      button: 0,
      sb: SB,
      bb: BB,
      seed: seedFrom(mulberry32(11)),
    });
    const view = viewOf(state, state.toAct!);
    expect(decide(view, () => 0.5)).toEqual(decide(view, () => 0.5, 4));
  });
});
