import { describe, expect, it } from 'vitest';
import { replay } from '@opentable/engine';
import type { HandConfig } from '@opentable/engine';
import type { LoggedAction } from '@opentable/protocol';
import {
  askFor,
  contestingSeats,
  knownHoles,
  practiceQuery,
  practiceSpot,
  priceAt,
  priceText,
  revealedSeats,
  streetPoints,
  streetRows,
} from '../analysis/replay-analysis.ts';
import type { Hole, StreetPoint } from '../analysis/replay-analysis.ts';
import { spotFromQuery } from '../tools/odds.tsx';

/* The same recorded hand the replay tests use: a 3bet pot heads-up that runs
   to a showdown the aces win. Recorded values, not computed ones. */
const SEED = 'a3f19c47d2b85e60193c7fa4b28d5e01c6a94f37d5b8e20a1f6c3d9047b5e28c';
const HOLES: Record<number, Hole> = { 0: ['Ac', 'As'], 1: ['Qd', 'Qh'] };

const CONFIG: HandConfig = {
  seats: [{ id: 'u-kestrel', stack: 200 }, { id: 'u-riverrat', stack: 200 }],
  button: 0,
  sb: 1,
  bb: 2,
  seed: SEED,
};

const ACTIONS: LoggedAction[] = [
  { s: 0, a: 'r', v: 6, t: 800 },
  { s: 1, a: 'r', v: 18, t: 2400 },
  { s: 0, a: 'c', t: 4000 },
  { s: 1, a: 'b', v: 14, t: 5600 },
  { s: 0, a: 'c', t: 7200 },
  { s: 1, a: 'x', t: 8800 },
  { s: 0, a: 'b', v: 30, t: 10400 },
  { s: 1, a: 'c', t: 12000 },
  { s: 1, a: 'x', t: 13600 },
  { s: 0, a: 'b', v: 60, t: 15200 },
  { s: 1, a: 'c', t: 16800 },
];

const STATES = replay(CONFIG, ACTIONS);
const MAP = [0, 1];
const LAST = STATES.length - 1;

describe('what is known at a step', () => {
  it('knows nothing while the hand is running', () => {
    const known = knownHoles({
      holes: HOLES,
      seats: MAP,
      revealed: revealedSeats(STATES[4], MAP),
      mine: null,
      showAll: false,
    });
    expect(known.size).toBe(0);
  });

  it('knows your own cards from the first step, if you played', () => {
    const known = knownHoles({
      holes: HOLES,
      seats: MAP,
      revealed: revealedSeats(STATES[0], MAP),
      mine: 1,
      showAll: false,
    });
    expect([...known.keys()]).toEqual([1]);
    expect(known.get(1)).toEqual(['Qd', 'Qh']);
  });

  it('knows every hand once the showdown has shown them', () => {
    const known = knownHoles({
      holes: HOLES,
      seats: MAP,
      revealed: revealedSeats(STATES[LAST], MAP),
      mine: null,
      showAll: false,
    });
    expect([...known.keys()].sort()).toEqual([0, 1]);
  });

  it('knows every hand at any step while show all cards is on', () => {
    const known = knownHoles({
      holes: HOLES,
      seats: MAP,
      revealed: revealedSeats(STATES[1], MAP),
      mine: null,
      showAll: true,
    });
    expect(known.size).toBe(2);
  });

  /* A hand still being played publishes no holdings at all, and a seat the row
     has no cards for is unknown however the switch is set. */
  it('knows nothing when the row carries no holdings', () => {
    expect(knownHoles({ holes: null, seats: MAP, revealed: [0, 1], mine: 0, showAll: true }).size).toBe(0);
    const partial = knownHoles({
      holes: { 0: ['Ac', 'As'] },
      seats: MAP,
      revealed: [],
      mine: null,
      showAll: true,
    });
    expect([...partial.keys()]).toEqual([0]);
  });

  it('reads the seats still in the hand, all in or not', () => {
    expect(contestingSeats(STATES[0], MAP)).toEqual([0, 1]);
  });
});

describe('the price of a call', () => {
  /* Button opens to 6, the big blind makes it 18: the call costs 12 into a pot
     of 24, so it has to win a third of what it makes. */
  it('reads the call, the pot behind it and the share it needs', () => {
    const price = priceAt(STATES[2], ACTIONS[2], MAP);
    expect(price).not.toBeNull();
    expect(price?.toCall).toBe(12);
    expect(price?.pot).toBe(24);
    expect(price?.needed).toBeCloseTo(1 / 3, 10);
  });

  it('prices a raise by what the raiser had to call first', () => {
    const price = priceAt(STATES[1], ACTIONS[1], MAP);
    expect(price?.toCall).toBe(4); // 2 posted, 6 to call
    expect(price?.pot).toBe(8);
  });

  it('has no price for a check, a bet or a fold', () => {
    expect(priceAt(STATES[5], ACTIONS[5], MAP)).toBeNull(); // check
    expect(priceAt(STATES[6], ACTIONS[6], MAP)).toBeNull(); // bet
    expect(priceAt(STATES[0], { s: 0, a: 'f', t: 0 }, MAP)).toBeNull();
  });

  it('has no price for a seat that never sat down', () => {
    expect(priceAt(STATES[2], { s: 4, a: 'c', t: 0 }, MAP)).toBeNull();
  });

  it('says the price on its own, and with the hand that paid it', () => {
    const price = { toCall: 12, pot: 24, needed: 1 / 3 };
    expect(priceText(price, null)).toBe('needed 33.3%');
    expect(priceText(price, 0.42)).toBe('needed 33.3%, had 42.0%');
  });
});

describe('the question put to the worker', () => {
  const known = new Map<number, Hole>([
    [0, ['Ac', 'As']],
    [1, ['Qd', 'Qh']],
  ]);

  it('asks about the hands that are known and a cloud for the rest', () => {
    const both = askFor(0, ['5h', '3d', '8d'], [0, 1], known);
    expect(both?.villains).toEqual([['Qd', 'Qh']]);

    const one = askFor(0, ['5h', '3d', '8d'], [0, 1, 2], known);
    expect(one?.villains).toEqual([['Qd', 'Qh'], 'random']);
  });

  /* A field of opponents is a set, not a list: two seats looking at the same
     board against the same hands are asking one question, and one answer
     serves the panel, the strip and the price beside an action. */
  it('keys a question by what was asked, not by who asked it', () => {
    const a = askFor(0, ['5h', '3d', '8d'], [0, 1, 2], known);
    const b = askFor(0, ['5h', '3d', '8d'], [0, 2, 1], known);
    expect(a?.key).toBe(b?.key);
    expect(a?.key).not.toBe(askFor(1, ['5h', '3d', '8d'], [0, 1], known)?.key);
  });

  it('asks nothing for an unknown hand or an uncontested pot', () => {
    expect(askFor(2, [], [0, 1, 2], known)).toBeNull();
    expect(askFor(0, [], [0], known)).toBeNull();
    expect(askFor(0, [], [1], known)).toBeNull(); // folded out of the hand
  });
});

describe('the street strip', () => {
  it('takes one point per street the hand reached, as the card lands', () => {
    const points = streetPoints(STATES, MAP);
    expect(points.map((p) => p.street)).toEqual(['pre', 'flop', 'turn', 'river']);
    expect(points.map((p) => p.board.length)).toEqual([0, 3, 4, 5]);
    expect(points.every((p) => p.live.length === 2)).toBe(true);
  });

  const POINTS: StreetPoint[] = [
    { street: 'pre', step: 0, board: [], live: [0, 1, 2] },
    { street: 'flop', step: 3, board: ['5h', '3d', '8d'], live: [0, 1] },
    { street: 'turn', step: 5, board: ['5h', '3d', '8d', 'Kc'], live: [0] },
  ];

  it('gives every known seat a row and every street it was still in a cell', () => {
    const known = new Map<number, Hole>([
      [0, ['Ac', 'As']],
      [1, ['Qd', 'Qh']],
      [2, ['7c', '2d']],
    ]);
    const rows = streetRows(POINTS, known);
    expect(rows.map((r) => r.seat)).toEqual([0, 1, 2]);
    expect(rows[0].cells.map((c) => c.street)).toEqual(['pre', 'flop', 'turn']);
    expect(rows[1].cells.map((c) => c.street)).toEqual(['pre', 'flop']);
    expect(rows[2].cells.map((c) => c.street)).toEqual(['pre']);
  });

  /* The turn cell of a pot everybody else folded is not a missing number: it
     is a pot with nobody left to have equity against. */
  it('leaves a last seat standing with a cell and no question', () => {
    const known = new Map<number, Hole>([[0, ['Ac', 'As']]]);
    const rows = streetRows(POINTS, known);
    expect(rows).toHaveLength(1);
    expect(rows[0].cells.map((c) => c.ask?.villains.length ?? null)).toEqual([2, 1, null]);
  });

  it('has no rows at all while nothing has been shown', () => {
    expect(streetRows(POINTS, new Map())).toEqual([]);
  });
});

describe('practising the spot', () => {
  it('turns a call into a spot the trainer can deal', () => {
    const known = new Map<number, Hole>([[0, ['Ac', 'As']]]);
    const spot = practiceSpot(STATES[2], ACTIONS[2], MAP, known);
    expect(spot).toEqual({ hand: 'AcAs', board: [], pot: 24, bet: 12, opponents: 1 });
    expect(practiceQuery(spot!)).toBe('/tools/odds?hand=AcAs&board=&pot=24&bet=12&opponents=1');
  });

  it('offers nothing for a raise, a check or a hand it cannot see', () => {
    const known = new Map<number, Hole>([[0, ['Ac', 'As']], [1, ['Qd', 'Qh']]]);
    expect(practiceSpot(STATES[1], ACTIONS[1], MAP, known)).toBeNull(); // a raise
    expect(practiceSpot(STATES[6], ACTIONS[6], MAP, known)).toBeNull(); // a bet
    expect(practiceSpot(STATES[2], ACTIONS[2], MAP, new Map())).toBeNull();
  });
});

describe('the trainer reading a spot off a link', () => {
  it('reads the whole spot', () => {
    expect(spotFromQuery('?hand=AhKd&board=Qs7h2c&pot=24&bet=8&opponents=1')).toEqual({
      hero: ['Ah', 'Kd'],
      board: ['Qs', '7h', '2c'],
      pot: 24,
      bet: 8,
      opponents: 1,
    });
  });

  it('takes a spot on any street, including one with no board', () => {
    expect(spotFromQuery('?hand=AhKd&board=&pot=24&bet=8')?.board).toEqual([]);
    expect(spotFromQuery('?hand=AhKd&pot=24&bet=8')?.opponents).toBe(1);
    expect(spotFromQuery('?hand=AhKd&board=Qs7h2c9dTs&pot=24&bet=8')?.board).toHaveLength(5);
  });

  it('holds the opponents inside what the equity call can deal', () => {
    expect(spotFromQuery('?hand=AhKd&pot=24&bet=8&opponents=99')?.opponents).toBe(8);
    expect(spotFromQuery('?hand=AhKd&pot=24&bet=8&opponents=0')?.opponents).toBe(1);
  });

  /* Anything half read sends the page back to its own generator rather than
     showing a spot built out of half a link. */
  it('refuses a spot that does not read', () => {
    expect(spotFromQuery('')).toBeNull();
    expect(spotFromQuery('?hand=Ah&pot=24&bet=8')).toBeNull();
    expect(spotFromQuery('?hand=AhZz&pot=24&bet=8')).toBeNull();
    expect(spotFromQuery('?hand=AhKd&board=Ah7h2c&pot=24&bet=8')).toBeNull(); // a card twice
    expect(spotFromQuery('?hand=AhKd&board=Qs7h2c&pot=0&bet=8')).toBeNull();
    expect(spotFromQuery('?hand=AhKd&board=Qs7h2c&pot=24&bet=x')).toBeNull();
  });
});
