import { describe, expect, it } from 'vitest';
import pokersolver from 'pokersolver';
import { apply, createHand, legal, newSeed, replay } from '../src/index.js';
import type { Action, ActionKind, HandConfig, HandState } from '../src/index.js';

const { Hand } = pokersolver;

const HANDS = 10_000;
const MAX_STEPS_PER_HAND = 500;

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function randomConfig(): HandConfig {
  const n = randInt(2, 6);
  const seats = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, stack: randInt(3, 400) }));
  const bigBlinds = Math.random() < 0.85;
  const sb = bigBlinds ? 1 : 5;
  const bb = bigBlinds ? 2 : 10;
  return { seats, button: randInt(0, n - 1), sb, bb, seed: newSeed() };
}

/* Weighted towards check/call so hands tend to reach showdown. */
const WEIGHTS: Record<ActionKind, number> = { f: 2, x: 6, c: 5, b: 3, r: 3, a: 1 };

function pickAction(state: HandState, seatIdx: number): Action {
  const leg = legal(state, seatIdx);
  const total = leg.actions.reduce((sum, a) => sum + WEIGHTS[a], 0);
  let roll = Math.random() * total;
  let chosen: ActionKind = leg.actions[leg.actions.length - 1];
  for (const a of leg.actions) {
    roll -= WEIGHTS[a];
    if (roll <= 0) {
      chosen = a;
      break;
    }
  }
  if (chosen === 'b' || chosen === 'r') {
    return { a: chosen, v: randInt(leg.min, leg.max) };
  }
  return { a: chosen };
}

function assertConserved(state: HandState, config: HandConfig): void {
  state.seats.forEach((s, i) => {
    expect(s.stack + s.committed).toBe(config.seats[i].stack);
  });
}

function orderFromButton(button: number, n: number, idxs: number[]): number[] {
  return [...idxs].sort((a, b) => {
    const da = (a - button - 1 + n) % n;
    const db = (b - button - 1 + n) % n;
    return da - db;
  });
}

/* Independently recomputes expected per-seat payouts from state.result.pots
   using pokersolver as the reference evaluator, applying the same
   odd-chip-to-first-left-of-button split rule the engine uses. */
function expectedPayoutsViaPokersolver(state: HandState): Record<number, number> {
  const n = state.seats.length;
  const expected: Record<number, number> = {};
  for (const pot of state.result!.pots) {
    if (pot.eligible.length === 0) continue;
    const solved = pot.eligible.map((idx) => ({
      idx,
      hand: Hand.solve([...state.seats[idx].cards!, ...state.board]),
    }));
    const winnerHands = Hand.winners(solved.map((s) => s.hand));
    const winners = solved.filter((s) => winnerHands.includes(s.hand)).map((s) => s.idx);
    const ordered = orderFromButton(state.config.button, n, winners);
    const base = Math.floor(pot.amount / ordered.length);
    const remainder = pot.amount % ordered.length;
    ordered.forEach((idx, k) => {
      expected[idx] = (expected[idx] ?? 0) + base + (k < remainder ? 1 : 0);
    });
  }
  return expected;
}

describe('fuzz: random hands', () => {
  it(
    `plays ${HANDS} random hands with conserved chips, correct replay, and pokersolver-verified showdowns`,
    () => {
      let showdowns = 0;

      for (let h = 0; h < HANDS; h++) {
        const config = randomConfig();
        const initialTotal = config.seats.reduce((sum, s) => sum + s.stack, 0);

        let state = createHand(config);
        let steps = 0;
        while (state.street !== 'done') {
          assertConserved(state, config);
          const seat = state.toAct;
          if (seat === null) {
            throw new Error(`hand ${h}: toAct is null but street is ${state.street}`);
          }
          const action = pickAction(state, seat);
          state = apply(state, seat, action);
          steps += 1;
          if (steps > MAX_STEPS_PER_HAND) {
            throw new Error(`hand ${h}: exceeded ${MAX_STEPS_PER_HAND} actions without finishing`);
          }
        }

        // chips conserved end to end
        const finalTotal = state.seats.reduce((sum, s) => sum + s.stack, 0);
        expect(finalTotal, `hand ${h}: chip conservation`).toBe(initialTotal);

        // replay reproduces the final state exactly
        const states = replay(config, state.actions);
        expect(states, `hand ${h}: replay length`).toHaveLength(state.actions.length + 1);
        expect(states[states.length - 1], `hand ${h}: replay reproduces final state`).toEqual(state);

        // showdown cross-check against pokersolver, pot by pot
        if (state.result && Object.keys(state.result.shown).length > 0) {
          showdowns += 1;
          const expected = expectedPayoutsViaPokersolver(state);
          const actual: Record<number, number> = {};
          for (const award of state.result.awards) actual[award.seat] = award.amount;
          expect(actual, `hand ${h}: pot winners/payouts match pokersolver`).toEqual(expected);
        }
      }

      // eslint-disable-next-line no-console
      console.log(`fuzz: ${showdowns} / ${HANDS} hands reached showdown`);
      expect(showdowns).toBeGreaterThan(0);
    },
    120_000,
  );
});
