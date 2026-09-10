import { describe, expect, it } from 'vitest';
import { computeMatchReview } from './match-review.js';
import type { HandRow, MatchRow, MatchSeat } from './db.js';
import type { MatchFormat } from '@opentable/protocol';

/* Pure, like insights.test.ts: real engine-accepted action logs, no
   database. computeMatchReview folds every seat's hands through the same
   computeInsights and computeRawRates insights.ts already proves, so these
   tests are about the match-level wiring (which seats get which hands, the
   study gate, the chip track) rather than re-proving the poker rules. */

const SEED = '11'.repeat(32);
const START = new Date('2026-09-01T12:00:00Z');

function format(over: Partial<MatchFormat> = {}): MatchFormat {
  return {
    mode: 'heads-up',
    players: 2,
    rated: true,
    hands: null,
    stack: 200,
    sb: 1,
    bb: 2,
    levels: [{ sb: 1, bb: 2 }],
    levelHands: 0,
    clockMs: 20_000,
    graceMs: 30_000,
    ...over,
  };
}

function seat(over: Partial<MatchSeat> = {}): MatchSeat {
  return { seat: 0, userId: 'u0', name: 'Alice', rating: 1500, bot: false, ...over };
}

function match(over: Partial<MatchRow> = {}): MatchRow {
  return {
    id: 'm1',
    format: format(),
    rated: true,
    seats: [seat({ seat: 0, userId: 'u0', name: 'Alice' }), seat({ seat: 1, userId: 'u1', name: 'Bob' })],
    status: 'finished',
    winner: 'u0',
    reason: 'hands',
    handsPlayed: 1,
    finalStacks: { u0: 220, u1: 180 },
    places: null,
    ratings: null,
    createdAt: START,
    finishedAt: START,
    ...over,
  };
}

interface HandOverrides {
  number?: number;
  button?: number;
  stacksStart?: number[];
  liveSeats?: number[];
  actions?: { s: number; a: 'f' | 'x' | 'c' | 'b' | 'r' | 'a'; v?: number; to?: boolean }[];
  study?: HandRow['study'];
  completedAt?: Date | null;
  matchId?: string;
}

function hand(over: HandOverrides = {}): HandRow {
  const number = over.number ?? 1;
  const matchId = over.matchId ?? 'm1';
  return {
    id: `${matchId}-${number}`,
    matchId,
    number,
    seedHash: 'hash',
    seed: SEED,
    button: over.button ?? 0,
    stacksStart: over.stacksStart ?? [200, 200],
    liveSeats: over.liveSeats ?? [0, 1],
    actions: (over.actions ?? [{ s: 0, a: 'f' }]).map((a, i) => ({ ...a, t: i * 100 })),
    board: [],
    holes: null,
    result: null,
    stats: null,
    study: over.study ?? null,
    sb: 1,
    bb: 2,
    startedAt: START,
    completedAt: over.completedAt === undefined ? new Date(START.getTime() + 10_000) : over.completedAt,
  };
}

describe('computeMatchReview', () => {
  it('gives every seat its own review, gated at the same MIN_INSIGHT_HANDS as a career', () => {
    const hands = Array.from({ length: 5 }, (_, i) => hand({ number: i + 1 }));
    const out = computeMatchReview(match(), hands);
    expect(out.hands).toBe(5);
    expect(out.seats).toHaveLength(2);
    const [a, b] = out.seats;
    expect(a.seat).toBe(0);
    expect(a.result).toBe('win');
    expect(b.result).toBe('loss');
    // Five hands is nowhere near MIN_INSIGHT_HANDS: the career-style numbers
    // stay null, the honesty computeInsights already enforces.
    expect(a.insights.preflop).toBeNull();
    expect(a.insights.sample.hands).toBe(5);
  });

  it('backs the short sample with raw counts instead of a rate', () => {
    const hands = Array.from({ length: 5 }, (_, i) => hand({ number: i + 1, actions: [{ s: 0, a: 'f' }] }));
    const out = computeMatchReview(match(), hands);
    const a = out.seats[0];
    // Folded every hand: 0 of 5 voluntarily played, a real count at a sample
    // computeInsights would refuse to summarise as a rate.
    expect(a.raw).toEqual(
      expect.objectContaining({ hands: 5, vpip: { made: 0, of: 5, pct: 0 } })
    );
  });

  it('never guesses a rate with no denominator, even in the raw counts', () => {
    // Nobody ever three-bets: the spot count is zero, so the rate is null,
    // not a count that happens to divide to zero.
    const hands = Array.from({ length: 5 }, (_, i) => hand({ number: i + 1, actions: [{ s: 0, a: 'c' }, { s: 1, a: 'x' }] }));
    const out = computeMatchReview(match(), hands);
    expect(out.seats[0].raw.threeBet).toEqual({ made: 0, of: 0, pct: null });
  });

  it('reads preflop accuracy from the stored study, only where the hand scored one', () => {
    const hands = [
      hand({
        number: 1,
        study: {
          0: { decisions: [], summary: { evLost: 0, accuracy: 90, count: 1 } },
          1: { decisions: [], summary: { evLost: 0, accuracy: 100, count: 0 } },
        },
      }),
      hand({
        number: 2,
        study: {
          0: { decisions: [], summary: { evLost: 0, accuracy: 70, count: 1 } },
        },
      }),
    ];
    const out = computeMatchReview(match(), hands);
    // Two scored hands, averaged.
    expect(out.seats[0].accuracy).toEqual({ mean: 80, hands: 2 });
    // Seat 1's one entry has count 0 (no scoreable decision, the vacuous 100
    // summarise() returns): excluded, so there is nothing to average and the
    // mean is null rather than 100.
    expect(out.seats[1].accuracy).toEqual({ mean: null, hands: 0 });
  });

  it('reports accuracy as null, not zero hands, on a mode that stores no study at all', () => {
    const hands = [hand({ number: 1, study: null })];
    const out = computeMatchReview(match(), hands);
    expect(out.seats[0].accuracy).toBeNull();
  });

  it('tracks chips into and out of the match from the stored starting stacks', () => {
    const hands = [
      hand({ number: 1, stacksStart: [200, 200] }),
      hand({ number: 2, stacksStart: [220, 180] }),
    ];
    const out = computeMatchReview(match({ finalStacks: { u0: 240, u1: 160 } }), hands);
    expect(out.seats[0].chips).toEqual([
      { hand: 1, chips: 200 },
      { hand: 2, chips: 220 },
      { hand: 3, chips: 240, final: true },
    ]);
  });

  it('leaves out a hand that never completed', () => {
    const hands = [hand({ number: 1 }), hand({ number: 2, completedAt: null })];
    const out = computeMatchReview(match(), hands);
    expect(out.hands).toBe(1);
    expect(out.seats[0].chips).toEqual([
      { hand: 1, chips: 200 },
      { hand: 2, chips: 220, final: true },
    ]);
  });
});
