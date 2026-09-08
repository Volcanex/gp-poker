import { describe, expect, it } from 'vitest';
import {
  computeInsights,
  longestWinStreak,
  positionKey,
  MIN_INSIGHT_HANDS,
  type InsightHand,
  type InsightMatch,
} from './insights.js';

/* Synthetic logs, no database. Every hand here is a real action log the
   engine accepts: the numbers below are what the rules produce, not what a
   fixture said they would be, so a change to the rules shows up as a failure
   here rather than as a wrong percentage on somebody's profile.

   Heads-up seating, which is what most of these use: the button is seat 0 and
   posts the small blind, seat 1 posts the big blind, the button acts first
   preflop and second on every street after it. */

const SEED = '11'.repeat(32);
const START = new Date('2026-09-01T12:00:00Z');

interface HandOverrides {
  number?: number;
  seat?: number;
  button?: number;
  stacksStart?: number[];
  liveSeats?: number[];
  actions?: { s: number; a: 'f' | 'x' | 'c' | 'b' | 'r' | 'a'; v?: number; to?: boolean }[];
  bb?: number;
  durationMs?: number;
  matchId?: string;
}

function hand(over: HandOverrides = {}): InsightHand {
  const number = over.number ?? 1;
  const matchId = over.matchId ?? 'm1';
  const durationMs = over.durationMs ?? 10_000;
  return {
    id: `${matchId}-${number}`,
    matchId,
    number,
    seat: over.seat ?? 0,
    seed: SEED,
    button: over.button ?? 0,
    sb: 1,
    bb: over.bb ?? 2,
    stacksStart: over.stacksStart ?? [200, 200],
    liveSeats: over.liveSeats ?? [0, 1],
    actions: (over.actions ?? [{ s: 0, a: 'f' }]).map((a, i) => ({ ...a, t: i * 100 })),
    startedAt: START,
    completedAt: new Date(START.getTime() + durationMs),
  };
}

function repeat(n: number, build: (i: number) => InsightHand): InsightHand[] {
  return Array.from({ length: n }, (_, i) => build(i));
}

function noMatches(): InsightMatch[] {
  return [];
}

describe('positionKey', () => {
  it('gives a heads-up table a button and a big blind, and no small blind', () => {
    expect(positionKey(0, 2)).toBe('button');
    expect(positionKey(1, 2)).toBe('big-blind');
  });

  it('names the six-max seats in order from the button', () => {
    const six = [0, 1, 2, 3, 4, 5].map((o) => positionKey(o, 6));
    expect(six).toEqual(['button', 'small-blind', 'big-blind', 'utg', 'hijack', 'cutoff']);
  });

  it('keeps the cutoff next to the blinds as the table shrinks', () => {
    expect(positionKey(4, 5)).toBe('cutoff');
    expect(positionKey(3, 5)).toBe('hijack');
    expect(positionKey(3, 4)).toBe('cutoff');
    expect(positionKey(2, 3)).toBe('big-blind');
  });
});

describe('longestWinStreak', () => {
  it('counts the longest run of wins, and a draw breaks it like a loss', () => {
    const at = (n: number) => new Date(START.getTime() + n * 1000);
    const results: InsightMatch['result'][] = ['win', 'win', 'draw', 'win', 'win', 'win', 'loss'];
    const matches = results.map((result, i) => ({ id: `m${i}`, result, finishedAt: at(i) }));
    // Handed to it newest first, the way the query returns them.
    expect(longestWinStreak([...matches].reverse())).toBe(3);
  });

  it('is zero with nothing won', () => {
    expect(longestWinStreak([{ id: 'm', result: 'loss', finishedAt: START }])).toBe(0);
  });
});

describe('computeInsights below the sample floor', () => {
  it('reports the sample and nothing else', () => {
    const hands = repeat(MIN_INSIGHT_HANDS - 1, (i) => hand({ number: i + 1 }));
    const out = computeInsights({ mode: 'heads-up', hands, matches: noMatches() });
    expect(out.sample.hands).toBe(MIN_INSIGHT_HANDS - 1);
    expect(out.minHands).toBe(MIN_INSIGHT_HANDS);
    expect(out.preflop).toBeNull();
    expect(out.postflop).toBeNull();
    expect(out.positions).toBeNull();
    expect(out.streets).toBeNull();
    expect(out.results).toBeNull();
  });

  it('counts matches from the match list, not from the hands', () => {
    const matches: InsightMatch[] = [
      { id: 'm1', result: 'win', finishedAt: START },
      { id: 'm2', result: 'loss', finishedAt: START },
    ];
    const out = computeInsights({ mode: 'heads-up', hands: [hand()], matches });
    expect(out.sample).toEqual({ hands: 1, matches: 2 });
  });
});

describe('computeInsights on a folding button', () => {
  const hands = repeat(MIN_INSIGHT_HANDS, (i) => hand({ number: i + 1, actions: [{ s: 0, a: 'f' }] }));
  const out = computeInsights({ mode: 'heads-up', hands, matches: noMatches() });

  it('plays no hands voluntarily', () => {
    expect(out.preflop).toEqual({ vpip: 0, pfr: 0, threeBet: null, foldToThreeBet: null });
  });

  it('leaves every postflop rate null rather than calling it zero', () => {
    expect(out.postflop).toEqual({
      aggressionFactor: null,
      cbet: null,
      wentToShowdown: null,
      wonAtShowdown: null,
      wonWithoutShowdown: null,
    });
  });

  it('ends every hand preflop and loses the small blind from the button', () => {
    expect(out.streets).toEqual({ preflop: 100, flop: 0, turn: 0, river: 0, showdown: 0 });
    expect(out.positions).toEqual([
      { key: 'button', hands: MIN_INSIGHT_HANDS, bbPerHand: -0.5 },
      { key: 'big-blind', hands: 0, bbPerHand: null },
    ]);
  });

  it('has no pot to name as the biggest', () => {
    expect(out.results?.biggestPot).toBeNull();
    expect(out.results?.averageHandMs).toBe(10_000);
    expect(out.results?.timeouts).toBe(0);
  });
});

/* Ten hands the player raises and continuation bets, ten they call down and
   give up on the turn. Every rate has a denominator, and each one is a
   different denominator: that is what this set is for. */
describe('computeInsights over a mixed set of hands', () => {
  const raiseAndCbet: HandOverrides['actions'] = [
    { s: 0, a: 'r', v: 6 },
    { s: 1, a: 'c' },
    { s: 1, a: 'x' },
    { s: 0, a: 'b', v: 4 },
    { s: 1, a: 'f' },
  ];
  const callAndFold: HandOverrides['actions'] = [
    { s: 0, a: 'c' },
    { s: 1, a: 'r', v: 6 },
    { s: 0, a: 'c' },
    { s: 1, a: 'b', v: 4 },
    { s: 0, a: 'c' },
    { s: 1, a: 'b', v: 8 },
    { s: 0, a: 'f' },
  ];
  const hands = [
    ...repeat(10, (i) => hand({ number: i + 1, actions: raiseAndCbet, durationMs: 20_000 })),
    ...repeat(10, (i) => hand({ number: i + 11, actions: callAndFold, durationMs: 40_000 })),
  ];
  const out = computeInsights({ mode: 'heads-up', hands, matches: noMatches() });

  it('separates hands played from hands raised', () => {
    expect(out.preflop?.vpip).toBe(100);
    expect(out.preflop?.pfr).toBe(50);
  });

  it('counts a call of an open as a three-bet spot that was not taken', () => {
    expect(out.preflop?.threeBet).toBe(0);
    // Nothing here ever faced a three-bet, so there is no rate to report.
    expect(out.preflop?.foldToThreeBet).toBeNull();
  });

  it('divides postflop bets and raises by postflop calls', () => {
    expect(out.postflop?.aggressionFactor).toBe(1);
  });

  it('measures continuation bets only where the flop posed the question', () => {
    // Ten hands as the preflop raiser, checked to on every one of them.
    expect(out.postflop?.cbet).toBe(100);
  });

  it('saw twenty flops, reached no showdowns and won without one every time', () => {
    expect(out.postflop?.wentToShowdown).toBe(0);
    expect(out.postflop?.wonAtShowdown).toBeNull();
    expect(out.postflop?.wonWithoutShowdown).toBe(100);
  });

  it('splits the hands between the street each one ended on', () => {
    expect(out.streets).toEqual({ preflop: 0, flop: 50, turn: 50, river: 0, showdown: 0 });
  });

  it('nets the button out at a big blind a hand behind', () => {
    // Won 16 chips over 10 committed on the c-bet hands, lost 10 on the rest.
    expect(out.positions?.[0]).toEqual({ key: 'button', hands: 20, bbPerHand: -1 });
  });

  it('names the biggest pot with the hand it was won in', () => {
    expect(out.results?.biggestPot).toEqual({
      chips: 16,
      bb: 8,
      handId: 'm1-1',
      matchId: 'm1',
      handNumber: 1,
    });
  });

  it('averages the hand durations', () => {
    expect(out.results?.averageHandMs).toBe(30_000);
  });
});

describe('computeInsights facing a three-bet', () => {
  const actions: HandOverrides['actions'] = [
    { s: 0, a: 'r', v: 6 },
    { s: 1, a: 'r', v: 18 },
    { s: 0, a: 'f' },
  ];
  it('reads the same hand from both sides of the raise', () => {
    const opener = computeInsights({
      mode: 'heads-up',
      hands: repeat(MIN_INSIGHT_HANDS, (i) => hand({ number: i + 1, seat: 0, actions })),
      matches: noMatches(),
    });
    expect(opener.preflop?.foldToThreeBet).toBe(100);
    expect(opener.preflop?.threeBet).toBeNull();

    const reraiser = computeInsights({
      mode: 'heads-up',
      hands: repeat(MIN_INSIGHT_HANDS, (i) => hand({ number: i + 1, seat: 1, actions })),
      matches: noMatches(),
    });
    expect(reraiser.preflop?.threeBet).toBe(100);
    expect(reraiser.preflop?.foldToThreeBet).toBeNull();
    expect(reraiser.positions).toEqual([
      { key: 'button', hands: 0, bbPerHand: null },
      { key: 'big-blind', hands: MIN_INSIGHT_HANDS, bbPerHand: 3 },
    ]);
  });
});

describe('computeInsights on an all-in', () => {
  /* Both players in for everything preflop: the board runs out and the hand
     is a showdown however the cards fall. The seed fixes the deck, so which
     seat wins is fixed too, and one of the two has to be the winner. */
  const hands = repeat(MIN_INSIGHT_HANDS, (i) =>
    hand({ number: i + 1, actions: [{ s: 0, a: 'a' }, { s: 1, a: 'c' }] })
  );
  const out = computeInsights({ mode: 'heads-up', hands, matches: noMatches() });

  it('runs the board out and lands in the showdown bucket', () => {
    expect(out.streets).toEqual({ preflop: 0, flop: 0, turn: 0, river: 0, showdown: 100 });
    expect(out.postflop?.wentToShowdown).toBe(100);
  });

  it('counts an all-in that nobody could call as aggression, not as a call', () => {
    // One shove, no calls of its own: there is nothing to divide by.
    expect(out.postflop?.aggressionFactor).toBeNull();
    expect(out.preflop?.pfr).toBe(100);
  });

  it('either wins every one of them or none of them, never a fraction', () => {
    expect([0, 100]).toContain(out.postflop?.wonAtShowdown);
  });
});

describe('computeInsights on six-max hands', () => {
  const folded: HandOverrides['actions'] = [
    { s: 3, a: 'f' },
    { s: 4, a: 'f' },
    { s: 5, a: 'f' },
    { s: 0, a: 'f' },
    { s: 1, a: 'f' },
  ];
  it('spreads the hands over all six seats as the button moves', () => {
    // The log is written for a button on seat 0; rotating the button rotates
    // who acts, so each hand rotates the seats in the log to match.
    const hands = repeat(24, (i) => {
      const button = i % 6;
      return hand({
        number: i + 1,
        seat: 0,
        button,
        stacksStart: [200, 200, 200, 200, 200, 200],
        liveSeats: [0, 1, 2, 3, 4, 5],
        actions: folded.map((a) => ({ ...a, s: (a.s + button) % 6 })),
      });
    });
    const out = computeInsights({ mode: 'six-max', hands, matches: noMatches() });
    expect(out.positions?.map((p) => p.key)).toEqual([
      'button', 'small-blind', 'big-blind', 'utg', 'hijack', 'cutoff',
    ]);
    expect(out.positions?.every((p) => p.hands === 4)).toBe(true);
    // The big blind is the only seat that wins any of these.
    const bigBlind = out.positions?.find((p) => p.key === 'big-blind');
    expect(bigBlind?.bbPerHand).toBe(0.5);
    expect(out.sample.hands).toBe(24);
  });
});

describe('computeInsights on rows it cannot read', () => {
  it('leaves out a hand whose log no longer replays, and keeps the rest', () => {
    const good = repeat(MIN_INSIGHT_HANDS, (i) => hand({ number: i + 1 }));
    // Seat 1 is not to act first preflop heads-up, so the engine refuses it.
    const broken = hand({ number: 99, actions: [{ s: 1, a: 'r', v: 6 }] });
    const out = computeInsights({ mode: 'heads-up', hands: [...good, broken], matches: noMatches() });
    expect(out.sample.hands).toBe(MIN_INSIGHT_HANDS);
  });

  it('leaves out a hand the player was already out of', () => {
    const hands = repeat(MIN_INSIGHT_HANDS, (i) => hand({ number: i + 1, seat: 4 }));
    const out = computeInsights({ mode: 'heads-up', hands, matches: noMatches() });
    expect(out.sample.hands).toBe(0);
  });
});

describe('computeInsights counts clock forfeits', () => {
  it('adds up the actions the clock took', () => {
    const hands = repeat(MIN_INSIGHT_HANDS, (i) =>
      hand({ number: i + 1, actions: [{ s: 0, a: 'f', to: i < 5 }] })
    );
    const out = computeInsights({ mode: 'heads-up', hands, matches: noMatches() });
    expect(out.results?.timeouts).toBe(5);
  });
});
