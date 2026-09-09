import { describe, expect, it } from 'vitest';
import type { Card, LegalActions, SeatView, Street, TableView } from '@opentable/protocol';
import { formatFor } from '@opentable/protocol';
import { decide } from './strategy.js';
import { NEUTRAL_PERSONA, personaFor, jitteredPersona, ARCHETYPES } from './persona.js';

/* A trimmed copy of server/test/strategy.test.ts's synthetic view builder:
   enough of a TableView for `decide` to run on, without a real engine hand
   behind it. Kept local rather than shared, the way strategy.test.ts's own
   copy is. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SeatSpec {
  stack: number;
  bet: number;
  cards?: Card[] | null;
}

function legalFor(seats: SeatSpec[], you: number, bb: number): LegalActions {
  const currentBet = Math.max(...seats.map((s) => s.bet), 0);
  const me = seats[you];
  const call = currentBet - me.bet;
  const maxTotal = me.bet + me.stack;
  const actions: LegalActions['actions'] = ['f'];
  actions.push(call <= 0 ? 'x' : 'c');
  if (currentBet === 0) actions.push('b');
  else if (maxTotal > currentBet) actions.push('r');
  actions.push('a');
  const min = currentBet === 0 ? Math.min(bb, me.stack) : Math.min(currentBet + bb, maxTotal);
  return { actions, call: Math.max(0, call), min, max: maxTotal };
}

function makeView(o: { street: Street; board: Card[]; seats: SeatSpec[]; you: number; pot: number }): TableView {
  const bb = 2;
  const seats: SeatView[] = o.seats.map((s, i) => ({
    i,
    uid: `u${i}`,
    name: `p${i}`,
    rating: 1500,
    stack: s.stack,
    bet: s.bet,
    cards: s.cards === undefined ? ['?', '?'] : s.cards,
    folded: false,
    allin: s.stack === 0,
    button: i === 0,
    acting: i === o.you,
    connected: true,
    bot: true,
    out: false,
    place: null,
    last: null,
  }));
  return {
    m: 'test',
    h: 1,
    n: 0,
    street: o.street,
    board: o.board,
    pot: o.pot,
    pots: [],
    seats,
    you: o.you,
    legal: legalFor(o.seats, o.you, bb),
    clock: null,
    seedHash: 'x',
    seed: null,
    format: formatFor('heads-up', true),
    blinds: { sb: bb / 2, bb },
    handsPlayed: 0,
    last: null,
    result: null,
  };
}

// A weak, disconnected, rainbow-board hand: below every level's bluff and
// value thresholds, so the only reason it ever bets is a bluff.
const WEAK_CHECKED_TO = () =>
  makeView({
    street: 'turn',
    board: ['Ks', 'Qd', '4c', '9h'],
    seats: [
      { stack: 400, bet: 0, cards: ['2h', '7c'] },
      { stack: 400, bet: 0, cards: ['?', '?'] },
    ],
    you: 0,
    pot: 40,
  });

// A lock: aces full of kings, comfortably over STRONG at every level.
const NUTS_CHECKED_TO = () =>
  makeView({
    street: 'river',
    board: ['Ad', 'Ks', 'Kd', '4c', '9h'],
    seats: [
      { stack: 2000, bet: 0, cards: ['Ah', 'Ac'] },
      { stack: 2000, bet: 0, cards: ['?', '?'] },
    ],
    you: 0,
    pot: 60,
  });

describe('persona', () => {
  it('the neutral persona is indistinguishable from omitting one', () => {
    const view = WEAK_CHECKED_TO();
    expect(decide(view, mulberry32(7), 2)).toEqual(decide(view, mulberry32(7), 2, NEUTRAL_PERSONA));
  });

  it('every archetype produces a persona with the expected shape', () => {
    for (const archetype of ARCHETYPES) {
      const persona = personaFor(archetype);
      expect(persona.archetype).toBe(archetype);
      for (const key of ['looseness', 'aggression', 'bluffChance', 'callCap'] as const) {
        expect(persona[key]).toBeGreaterThan(0);
      }
    }
  });

  it('jitteredPersona stays within +/-15% of the archetype base and is seed-stable', () => {
    const base = personaFor('lag');
    const rng = mulberry32(3);
    const jittered = jitteredPersona('lag', rng);
    expect(jittered.aggression).toBeGreaterThanOrEqual(base.aggression * 0.85 - 1e-9);
    expect(jittered.aggression).toBeLessThanOrEqual(base.aggression * 1.15 + 1e-9);
    expect(jitteredPersona('lag', mulberry32(3))).toEqual(jittered);
  });

  it('a maniac bluffs a hopeless hand far more often than a nit at the same level', () => {
    const nit = personaFor('nit');
    const maniac = personaFor('maniac');
    let nitBluffs = 0;
    let maniacBluffs = 0;
    const n = 500;
    for (let i = 0; i < n; i++) {
      const view = WEAK_CHECKED_TO();
      if (decide(view, mulberry32(i), 2, nit).a === 'b') nitBluffs++;
      if (decide(view, mulberry32(i), 2, maniac).a === 'b') maniacBluffs++;
    }
    expect(maniacBluffs).toBeGreaterThan(nitBluffs * 2);
  });

  it('a maniac sizes a value bet larger than a nit in the same spot', () => {
    const view = NUTS_CHECKED_TO();
    const nitDecision = decide(view, mulberry32(1), 4, personaFor('nit'));
    const maniacDecision = decide(view, mulberry32(1), 4, personaFor('maniac'));
    expect(nitDecision.a).toBe('b');
    expect(maniacDecision.a).toBe('b');
    expect(maniacDecision.v!).toBeGreaterThan(nitDecision.v!);
  });
});
