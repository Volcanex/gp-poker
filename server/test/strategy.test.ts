import { describe, expect, it } from 'vitest';
import type { Card, LegalActions, SeatView, Street, TableView } from '@opentable/protocol';
import { formatFor } from '@opentable/protocol';
import { decide, handStrength } from '../src/bots/strategy.js';

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

const RANKS = '23456789TJQKA';
const SUITS = 'shdc';
const DECK: Card[] = [...RANKS].flatMap((r) => [...SUITS].map((s) => `${r}${s}`));

interface SeatSpec {
  stack: number;
  bet: number;
  cards?: Card[] | null;
  folded?: boolean;
}

// The engine's own legal() rules, restated over a view so a synthetic spot
// offers exactly what a real one would.
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

function makeView(o: {
  street: Street;
  board: Card[];
  seats: SeatSpec[];
  you: number;
  button: number;
  pot: number;
  bb?: number;
  mode?: 'heads-up' | 'six-max';
}): TableView {
  const bb = o.bb ?? 2;
  const seats: SeatView[] = o.seats.map((s, i) => ({
    i,
    uid: `u${i}`,
    name: `p${i}`,
    rating: 1500,
    stack: s.stack,
    bet: s.bet,
    cards: s.cards === undefined ? ['?', '?'] : s.cards,
    folded: s.folded ?? false,
    allin: s.stack === 0,
    button: i === o.button,
    acting: i === o.you,
    connected: true,
    bot: false,
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
    format: formatFor(o.mode ?? 'heads-up', true),
    blinds: { sb: bb / 2, bb },
    handsPlayed: 0,
    last: null,
    result: null,
  };
}

describe('bot strategy legality', () => {
  it('only ever returns an action the view offered, across a wide spread of spots', () => {
    const rng = mulberry32(99);
    for (let iter = 0; iter < 400; iter++) {
      const deck = [...DECK].sort(() => rng() - 0.5);
      const players = 2 + Math.floor(rng() * 5);
      const street: Street = (['pre', 'flop', 'turn', 'river'] as Street[])[Math.floor(rng() * 4)];
      const boardSize = street === 'pre' ? 0 : street === 'flop' ? 3 : street === 'turn' ? 4 : 5;
      const you = Math.floor(rng() * players);
      const bb = [2, 4, 10, 40][Math.floor(rng() * 4)];

      const board = deck.slice(0, boardSize);
      const hole: Card[] = [deck[boardSize], deck[boardSize + 1]];
      const seats: SeatSpec[] = [];
      for (let i = 0; i < players; i++) {
        const stack = Math.floor(rng() * 200);
        const bet = Math.floor(rng() * 3) === 0 ? Math.floor(rng() * 40) : 0;
        seats.push({ stack, bet, cards: i === you ? hole : ['?', '?'] });
      }
      // The acting seat must have something behind, or it would not be asked.
      seats[you].stack = Math.max(1, seats[you].stack);

      const view = makeView({
        street,
        board,
        seats,
        you,
        button: Math.floor(rng() * players),
        pot: seats.reduce((sum, s) => sum + s.bet, 0) + Math.floor(rng() * 100),
        bb,
      });

      const decision = decide(view, rng);
      expect(view.legal!.actions).toContain(decision.a);
      if (decision.a === 'b' || decision.a === 'r') {
        expect(decision.v).toBeGreaterThanOrEqual(view.legal!.min);
        expect(decision.v).toBeLessThanOrEqual(view.legal!.max);
        expect(Number.isInteger(decision.v)).toBe(true);
      } else {
        expect(decision.v).toBeUndefined();
      }
    }
  });
});

describe('bot strategy decisions', () => {
  const half = () => 0.5;

  it('raises the best hand heads-up on the button', () => {
    const view = makeView({
      street: 'pre',
      board: [],
      seats: [
        { stack: 199, bet: 1, cards: ['Ah', 'Ad'] },
        { stack: 198, bet: 2 },
      ],
      you: 0,
      button: 0,
      pot: 3,
    });
    const decision = decide(view, half);
    expect(['r', 'a']).toContain(decision.a);
  });

  it('folds the worst hand facing a three-bet', () => {
    const view = makeView({
      street: 'pre',
      board: [],
      seats: [
        { stack: 194, bet: 6, cards: ['7h', '2d'] },
        { stack: 182, bet: 18 },
      ],
      you: 0,
      button: 0,
      pot: 24,
    });
    expect(decide(view, half).a).toBe('f');
  });

  it('bets a monster when it is checked to', () => {
    const view = makeView({
      street: 'flop',
      board: ['As', 'Ac', '2h'],
      seats: [
        { stack: 180, bet: 0, cards: ['Ah', 'Ad'] },
        { stack: 180, bet: 0 },
      ],
      you: 0,
      button: 1,
      pot: 40,
    });
    const decision = decide(view, half);
    expect(['b', 'a']).toContain(decision.a);
  });

  it('folds air to a big bet', () => {
    const view = makeView({
      street: 'flop',
      board: ['As', 'Kc', 'Qh'],
      seats: [
        { stack: 180, bet: 0, cards: ['2h', '3d'] },
        { stack: 80, bet: 100 },
      ],
      you: 0,
      button: 1,
      pot: 110,
    });
    expect(decide(view, half).a).toBe('f');
  });

  it('calls a token bet on the pot odds with a hand too weak to raise', () => {
    // T9 on AKQ beats about 47% of the holdings still out there: not enough
    // to bet, far more than the 2% the price is asking for.
    const view = makeView({
      street: 'flop',
      board: ['As', 'Kc', 'Qh'],
      seats: [
        { stack: 180, bet: 0, cards: ['Th', '9d'] },
        { stack: 178, bet: 2 },
      ],
      you: 0,
      button: 1,
      pot: 102,
    });
    expect(decide(view, half).a).toBe('c');
  });

  it('shoves a short stack with a good hand and folds a bad one', () => {
    const seats = (cards: Card[]): SeatSpec[] => [
      { stack: 14, bet: 1, cards },
      { stack: 100, bet: 2 },
    ];
    const shove = makeView({
      street: 'pre',
      board: [],
      seats: seats(['Ah', 'Kh']),
      you: 0,
      button: 0,
      pot: 3,
      mode: 'six-max',
    });
    // Six-handed, so the multiway thresholds apply rather than the charts.
    shove.seats.push(
      ...[2, 3, 4, 5].map((i) => ({ ...shove.seats[1], i, uid: `u${i}`, name: `p${i}`, acting: false }))
    );
    expect(['a', 'r']).toContain(decide(shove, half).a);

    const give = makeView({
      street: 'pre',
      board: [],
      seats: seats(['7h', '2d']),
      you: 0,
      button: 0,
      pot: 3,
      mode: 'six-max',
    });
    give.seats.push(
      ...[2, 3, 4, 5].map((i) => ({ ...give.seats[1], i, uid: `u${i}`, name: `p${i}`, acting: false }))
    );
    expect(decide(give, half).a).toBe('f');
  });
});

describe('handStrength', () => {
  it('is near certain with quads and near hopeless with nothing', () => {
    expect(handStrength(['Ah', 'Ad'], ['As', 'Ac', '2h'])).toBeGreaterThan(0.99);
    expect(handStrength(['2h', '3d'], ['As', 'Kc', 'Qh'])).toBeLessThan(0.2);
  });
});
