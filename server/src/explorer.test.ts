import { describe, expect, it } from 'vitest';
import { replay } from '@opentable/engine';
import { handClass } from '@opentable/preflop';
import type { Card, LoggedAction } from '@opentable/protocol';
import {
  computeExplorer,
  emptyExplorerCube,
  explorerQuery,
  foldExplorerHands,
  sliceExplorer,
  MIN_EXPLORER_HANDS,
  type ExplorerHand,
  type ExplorerQuery,
} from './explorer.js';

/* Synthetic logs, no database. Every hand here is a real action log the engine
   accepts and a real seed, so the hole cards are the ones the deal produces
   rather than the ones a fixture claimed. The tests never hardcode a hand
   class: `dealt()` asks the engine what it dealt and the assertion looks that
   class up, so a change to the shuffle moves the cards without breaking a
   single expectation.

   Heads-up seating unless a test says otherwise: the button is seat 0 and
   posts the small blind, seat 1 posts the big blind, and the button acts
   first preflop. */

const SEED = '11'.repeat(32);
const OTHER_SEED = '22'.repeat(32);
const FINISHED = new Date('2026-09-01T12:00:00Z');

type Act = { s: number; a: 'f' | 'x' | 'c' | 'b' | 'r' | 'a'; v?: number };

interface HandOverrides {
  matchId?: string;
  seed?: string;
  button?: number;
  stacksStart?: number[];
  liveSeats?: number[];
  bots?: boolean[];
  bb?: number;
  finishedAt?: Date | null;
  actions?: Act[];
}

function hand(over: HandOverrides = {}): ExplorerHand {
  const stacksStart = over.stacksStart ?? [200, 200];
  return {
    matchId: over.matchId ?? 'm1',
    button: over.button ?? 0,
    sb: 1,
    bb: over.bb ?? 2,
    seed: over.seed ?? SEED,
    stacksStart,
    liveSeats: over.liveSeats ?? stacksStart.map((_, i) => i),
    actions: (over.actions ?? [{ s: 0, a: 'f' }]).map((a, i) => ({ ...a, t: i * 100 }) as LoggedAction),
    bots: over.bots ?? stacksStart.map(() => false),
    finishedAt: over.finishedAt === undefined ? FINISHED : over.finishedAt,
  };
}

/* The class the engine dealt to one engine seat, read back out of the opening
   state the same way the explorer reads it. */
function dealt(h: ExplorerHand, engineSeat: number): string {
  const button = h.liveSeats.indexOf(h.button);
  const state = replay(
    {
      seats: h.liveSeats.map((t) => ({ id: String(t), stack: h.stacksStart[t] ?? 0 })),
      button,
      sb: h.sb,
      bb: h.bb,
      seed: h.seed,
    },
    []
  )[0];
  return handClass(state.seats[engineSeat].cards as [Card, Card]);
}

function view(hands: ExplorerHand[], query: Partial<ExplorerQuery> = {}) {
  const cube = computeExplorer({ mode: 'heads-up', hands });
  return sliceExplorer(cube, {
    position: query.position ?? 'button',
    facing: query.facing ?? 'unopened',
    players: query.players ?? 'all',
  });
}

function row(v: ReturnType<typeof view>, cls: string) {
  const found = v.hands.find((r) => r.hand === cls);
  if (!found) throw new Error(`${cls} is not in the grid`);
  return found;
}

describe('the shape of a reading', () => {
  it('returns all 169 classes whether or not anyone was dealt them', () => {
    const v = view([hand()]);
    expect(v.hands).toHaveLength(169);
    expect(new Set(v.hands.map((r) => r.hand)).size).toBe(169);
  });

  it('reports zero hands as no rate rather than as a zero rate', () => {
    const h = hand();
    const v = view([h]);
    const empty = v.hands.find((r) => r.hand !== dealt(h, 0) && r.hand !== dealt(h, 1))!;
    expect(empty.hands).toBe(0);
    expect(empty.raise).toBeNull();
    expect(empty.fold).toBeNull();
    expect(empty.netBb).toBeNull();
  });

  it('carries the minimum a selection is worth reading at', () => {
    expect(view([hand()]).minHands).toBe(MIN_EXPLORER_HANDS);
    expect(MIN_EXPLORER_HANDS).toBe(50);
  });

  it('dates the book from the earliest match it counted', () => {
    const early = new Date('2026-07-04T09:00:00Z');
    const v = view([hand({ matchId: 'a', finishedAt: FINISHED }), hand({ matchId: 'b', finishedAt: early })]);
    expect(v.since).toBe(early.toISOString());
    expect(v.sample.matches).toBe(2);
  });
});

describe('one decision at a time', () => {
  it('counts the button folding preflop, at the price of the small blind', () => {
    const h = hand({ actions: [{ s: 0, a: 'f' }] });
    const v = view([h]);
    const r = row(v, dealt(h, 0));
    expect(r.hands).toBe(1);
    expect(r.fold).toBe(100);
    expect(r.raise).toBe(0);
    expect(r.netBb).toBe(-0.5);
  });

  it('puts the big blind facing that fold nowhere: it never acted', () => {
    const h = hand({ actions: [{ s: 0, a: 'f' }] });
    const bb = view([h], { position: 'big-blind', facing: 'unopened' });
    expect(bb.sample.hands).toBe(0);
  });

  it('reads a raise as a raise and the call behind it as a call', () => {
    const h = hand({ actions: [{ s: 0, a: 'r', v: 6 }, { s: 1, a: 'c' }, ...checkDown()] });
    const opener = view([h]);
    expect(row(opener, dealt(h, 0)).raise).toBe(100);

    const defender = view([h], { position: 'big-blind', facing: 'open' });
    expect(row(defender, dealt(h, 1)).call).toBe(100);
  });

  it('counts a check in the big blind as a call, not as a hand nobody played', () => {
    const h = hand({ actions: [{ s: 0, a: 'c' }, { s: 1, a: 'x' }, ...checkDown()] });
    const v = view([h], { position: 'big-blind', facing: 'unopened' });
    expect(row(v, dealt(h, 1)).call).toBe(100);
  });

  it('reads an all-in that cannot reach the bet as a call, not as a raise', () => {
    /* The big blind has 8 behind after posting, so shoving over a raise to 40
       is a call for less rather than a three-bet. The three checks after it
       are the big stack being asked to act on a board nobody can bet into,
       which is what the engine does with an all-in for less heads-up. */
    const h = hand({
      stacksStart: [200, 10],
      actions: [{ s: 0, a: 'r', v: 40 }, { s: 1, a: 'a' }, { s: 0, a: 'x' }, { s: 0, a: 'x' }, { s: 0, a: 'x' }],
    });
    const v = view([h], { position: 'big-blind', facing: 'open' });
    expect(row(v, dealt(h, 1)).call).toBe(100);
    expect(row(v, dealt(h, 1)).raise).toBe(0);
  });
});

describe('what a seat was facing', () => {
  it('counts the opener under unopened and again under the three-bet it faced', () => {
    const h = hand({
      actions: [{ s: 0, a: 'r', v: 6 }, { s: 1, a: 'r', v: 20 }, { s: 0, a: 'f' }],
    });
    const cls = dealt(h, 0);

    const open = view([h], { position: 'button', facing: 'unopened' });
    expect(row(open, cls).raise).toBe(100);

    const squeezed = view([h], { position: 'button', facing: 'threebet' });
    expect(row(squeezed, cls).fold).toBe(100);
    // The same hand, so the same result, attached to both spots it passed
    // through: the reading is "how it went from here", not "what this action
    // was worth".
    expect(row(open, cls).netBb).toBe(row(squeezed, cls).netBb);
  });

  it('counts a seat once per bucket however many raises it faces', () => {
    const h = hand({
      actions: [
        { s: 0, a: 'r', v: 6 },
        { s: 1, a: 'r', v: 20 },
        { s: 0, a: 'r', v: 60 },
        { s: 1, a: 'r', v: 140 },
        { s: 0, a: 'f' },
      ],
    });
    // The button acted at two raises and again at three; both are 'threebet'
    // and only the first is counted.
    const v = view([h], { position: 'button', facing: 'threebet' });
    expect(v.sample.hands).toBe(1);
    expect(row(v, dealt(h, 0)).raise).toBe(100);
  });

  it('leaves postflop alone even when the whole log is handed over', () => {
    const h = hand({
      actions: [
        { s: 0, a: 'c' },
        { s: 1, a: 'x' },
        { s: 1, a: 'b', v: 10 },
        { s: 0, a: 'c' },
        { s: 1, a: 'b', v: 30 },
        { s: 0, a: 'f' },
      ],
    });
    // The flop bet is a raise on its own street and would read as a three-bet
    // spot if the walk did not stop where the street turns.
    const three = view([h], { position: 'big-blind', facing: 'open' });
    expect(three.sample.hands).toBe(0);
    const pre = view([h], { position: 'big-blind', facing: 'unopened' });
    expect(pre.sample.hands).toBe(1);
  });
});

describe('who was at the table', () => {
  it('keeps bot seats out of the human reading and in the whole one', () => {
    const h = hand({ bots: [true, false], actions: [{ s: 0, a: 'f' }] });
    expect(view([h], { players: 'all' }).sample.hands).toBe(1);
    expect(view([h], { players: 'humans' }).sample.hands).toBe(0);
  });

  it('counts a person acting at a table with a bot in it', () => {
    const h = hand({
      bots: [true, false],
      actions: [{ s: 0, a: 'r', v: 6 }, { s: 1, a: 'f' }],
    });
    const v = view([h], { position: 'big-blind', facing: 'open', players: 'humans' });
    expect(row(v, dealt(h, 1)).fold).toBe(100);
  });

  it('dates the human book from the first match a person was in', () => {
    const early = new Date('2026-07-04T09:00:00Z');
    const hands = [
      hand({ matchId: 'bots', bots: [true, true], finishedAt: early }),
      hand({ matchId: 'people', bots: [false, false], finishedAt: FINISHED }),
    ];
    expect(view(hands, { players: 'all' }).since).toBe(early.toISOString());
    expect(view(hands, { players: 'humans' }).since).toBe(FINISHED.toISOString());
  });
});

describe('totals over many hands', () => {
  it('averages the rates and the big blinds over every decision in the slice', () => {
    // Four hands from two seeds: three folds and one raise, so the slice is
    // 75% fold and the average is the mean of the four results.
    const hands = [
      hand({ matchId: 'a', seed: SEED, actions: [{ s: 0, a: 'f' }] }),
      hand({ matchId: 'b', seed: SEED, actions: [{ s: 0, a: 'f' }] }),
      hand({ matchId: 'c', seed: OTHER_SEED, actions: [{ s: 0, a: 'f' }] }),
      hand({ matchId: 'd', seed: OTHER_SEED, actions: [{ s: 0, a: 'r', v: 6 }, { s: 1, a: 'f' }] }),
    ];
    const v = view(hands);
    expect(v.totals.hands).toBe(4);
    expect(v.totals.fold).toBe(75);
    expect(v.totals.raise).toBe(25);
    // Three small blinds lost, one big blind won.
    expect(v.totals.netBb).toBe(round2((-0.5 * 3 + 1) / 4));
  });

  it('adds the per class rows up to the total', () => {
    const hands = [
      hand({ matchId: 'a', seed: SEED, actions: [{ s: 0, a: 'f' }] }),
      hand({ matchId: 'b', seed: OTHER_SEED, actions: [{ s: 0, a: 'f' }] }),
    ];
    const v = view(hands);
    expect(v.hands.reduce((sum, r) => sum + r.hands, 0)).toBe(v.totals.hands);
  });
});

describe('six-max', () => {
  const SIX = [200, 200, 200, 200, 200, 200];

  it('names the seat that opens under the gun', () => {
    // Six seats, button 0: seat 1 is the small blind, seat 2 the big blind,
    // and seat 3 is first to act and under the gun.
    const h = hand({
      stacksStart: SIX,
      actions: [{ s: 3, a: 'r', v: 6 }, { s: 4, a: 'f' }, { s: 5, a: 'f' }, { s: 0, a: 'f' }, { s: 1, a: 'f' }, { s: 2, a: 'f' }],
    });
    const cube = computeExplorer({ mode: 'six-max', hands: [h] });
    const utg = sliceExplorer(cube, { position: 'utg', facing: 'unopened', players: 'all' });
    expect(row(utg, dealt(h, 3)).raise).toBe(100);

    const cutoff = sliceExplorer(cube, { position: 'cutoff', facing: 'open', players: 'all' });
    expect(row(cutoff, dealt(h, 5)).fold).toBe(100);
  });

  it('reads a seat that busted out of the table by where it sat this hand', () => {
    // Four live seats out of six: table seats 2 and 4 are gone, so the button
    // (table seat 1) is engine seat 0 and table seat 5 is the big blind.
    const h = hand({
      stacksStart: [100, 100, 0, 100, 0, 100],
      liveSeats: [1, 3, 5, 0],
      button: 1,
      actions: [{ s: 0, a: 'r', v: 6 }, { s: 1, a: 'f' }, { s: 3, a: 'f' }, { s: 5, a: 'f' }],
    });
    const cube = computeExplorer({ mode: 'six-max', hands: [h] });
    const bb = sliceExplorer(cube, { position: 'big-blind', facing: 'open', players: 'all' });
    expect(row(bb, dealt(h, 2)).fold).toBe(100);
  });
});

describe('adding to a cube instead of rebuilding it', () => {
  const hands = [
    hand({ matchId: 'a', seed: SEED, actions: [{ s: 0, a: 'f' }] }),
    hand({ matchId: 'b', seed: OTHER_SEED, actions: [{ s: 0, a: 'r', v: 6 }, { s: 1, a: 'f' }] }),
    hand({ matchId: 'c', seed: SEED, actions: [{ s: 0, a: 'r', v: 6 }, { s: 1, a: 'c' }, ...checkDown()] }),
  ];

  it('reaches the same reading however the hands are split up', () => {
    const whole = computeExplorer({ mode: 'heads-up', hands });

    const pieces = emptyExplorerCube('heads-up');
    foldExplorerHands(pieces, hands.slice(0, 1));
    foldExplorerHands(pieces, hands.slice(1));

    const query: ExplorerQuery = { position: 'button', facing: 'unopened', players: 'all' };
    expect(sliceExplorer(pieces, query)).toEqual(sliceExplorer(whole, query));
  });

  it('says how many of the hands it was handed actually counted', () => {
    const cube = emptyExplorerCube('heads-up');
    // The second log asks a seat that is not at the table to act, so it cannot
    // be replayed and is not a hand with nothing in it.
    const counted = foldExplorerHands(cube, [hands[0], hand({ matchId: 'broken', actions: [{ s: 4, a: 'f' }] })]);
    expect(counted).toBe(1);
    expect(sliceExplorer(cube, { position: 'button', facing: 'unopened', players: 'all' }).sample.hands).toBe(1);
  });
});

describe('reading the controls', () => {
  it('falls back rather than erroring on anything it does not know', () => {
    expect(explorerQuery('heads-up', {})).toEqual({ position: 'button', facing: 'unopened', players: 'all' });
    expect(explorerQuery('heads-up', { position: 'nonsense', facing: 'nonsense', players: 'nonsense' })).toEqual({
      position: 'button',
      facing: 'unopened',
      players: 'all',
    });
  });

  it('refuses a position that belongs to the other mode', () => {
    expect(explorerQuery('heads-up', { position: 'cutoff' }).position).toBe('button');
    expect(explorerQuery('six-max', { position: 'cutoff' }).position).toBe('cutoff');
  });

  it('takes the controls it does know', () => {
    expect(explorerQuery('six-max', { position: 'hijack', facing: 'threebet', players: 'humans' })).toEqual({
      position: 'hijack',
      facing: 'threebet',
      players: 'humans',
    });
  });
});

/* Six checks: heads-up, the big blind acts first on every street after the
   flop, so a hand nobody bets again runs out in this order. */
function checkDown(): Act[] {
  return [
    { s: 1, a: 'x' }, { s: 0, a: 'x' },
    { s: 1, a: 'x' }, { s: 0, a: 'x' },
    { s: 1, a: 'x' }, { s: 0, a: 'x' },
  ];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
