import { describe, expect, test } from 'vitest';
import { bestFive } from '@opentable/equity';
import { ALL_CLASSES } from '@opentable/equity/range';
import {
  bucketFor as realBucketFor,
  chartFor as realChartFor,
  percentileOf as realPercentileOf,
  regionsOf as realRegionsOf,
  scoreDecision as realScoreDecision,
  type DecisionAction,
  type Spot as RealSpot,
  type StackBucket,
} from '@opentable/preflop';
import { solveShowdown } from '../analysis/showdown-solve.ts';
import {
  BUCKETS,
  SPOTS_BY_BUCKET,
  bucketFor,
  chartFor,
  percentileOf,
  regionsOf,
  scoreDecision,
  type Action,
} from '../puzzles/chart.ts';
import {
  MAX_LEVEL as SHOWDOWN_MAX_LEVEL,
  dealShowdown,
  levelFor as showdownLevelFor,
  shapeFor,
  winnersFrom,
  type ShowdownKind,
} from '../puzzles/showdown.ts';
import {
  MAX_LEVEL as PREFLOP_MAX_LEVEL,
  cardsFor,
  dealPreflop,
  distanceToBoundary,
  gradePreflop,
  gridFor,
  windowFor,
} from '../puzzles/preflop.ts';
import { afterAnswer, emptyPuzzles, parsePuzzles, today } from '../puzzles/store.ts';

/* A cheap deterministic stream, the same trick the odds trainer's tests use:
   enough spread to walk every branch without pulling in a PRNG. */
function cycler(step = 0.137, start = 0) {
  let value = start;
  return () => {
    value = (value + step) % 1;
    return value;
  };
}

const KINDS: ShowdownKind[] = ['random', 'kicker', 'counterfeit', 'board'];

describe('the chart the client grades against', () => {
  test('it is the chart the server grades against', () => {
    for (const bucket of BUCKETS) {
      for (const spot of SPOTS_BY_BUCKET[bucket]) {
        expect(chartFor(bucket, spot)).toEqual(realChartFor(bucket as StackBucket, spot as RealSpot));
        expect(regionsOf(chartFor(bucket, spot))).toEqual(realRegionsOf(realChartFor(bucket as StackBucket, spot as RealSpot)));
      }
    }
  });

  test('every hand class has the same percentile in both', () => {
    for (const hand of ALL_CLASSES) {
      expect(percentileOf(hand)).toBeCloseTo(realPercentileOf(hand), 12);
    }
  });

  test('every decision scores the same in both', () => {
    const actions: Action[] = ['aggr', 'passive', 'fold'];
    for (const bucket of BUCKETS) {
      for (const spot of SPOTS_BY_BUCKET[bucket]) {
        for (const hand of ALL_CLASSES) {
          for (const action of actions) {
            const mine = scoreDecision({ bucket, spot, hand, action });
            const theirs = realScoreDecision({
              bucket: bucket as StackBucket,
              spot: spot as RealSpot,
              hand,
              action: action as DecisionAction,
            });
            expect(mine.best).toBe(theirs.best);
            expect(mine.inRange).toBe(theirs.inRange);
            expect(mine.evLost).toBeCloseTo(theirs.evLost, 12);
          }
        }
      }
    }
  });

  test('stack buckets are cut in the same places', () => {
    for (let bb = 1; bb <= 200; bb++) {
      expect(bucketFor(bb)).toBe(realBucketFor(bb));
    }
  });
});

describe('the showdown generator', () => {
  test('no card is ever dealt twice', () => {
    for (const kind of KINDS) {
      for (let hands = 2; hands <= (kind === 'board' || kind === 'random' ? 4 : 3); hands++) {
        const random = cycler(0.0913, kind.length / 10);
        for (let i = 0; i < 120; i++) {
          const puzzle = dealShowdown({ hands, kind }, random);
          const cards = [...puzzle.board, ...puzzle.hands.flat()];
          expect(cards).toHaveLength(5 + hands * 2);
          expect(new Set(cards).size).toBe(cards.length);
        }
      }
    }
  });

  test('the winner it is graded on is the answer the evaluator gives', () => {
    const random = cycler(0.0371);
    for (let i = 0; i < 200; i++) {
      const puzzle = dealShowdown(shapeFor(i % 20), random);
      const read = solveShowdown(puzzle.board, puzzle.hands);
      const strengths = puzzle.hands.map((hole) => bestFive([...hole, ...puzzle.board]).strength);
      expect(read.hands.map((h) => h.strength)).toEqual(strengths);
      expect(read.winners).toEqual(winnersFrom(strengths));
      expect(read.winners.length).toBeGreaterThan(0);
      for (const h of read.hands) expect(h.name.length).toBeGreaterThan(0);
    }
  });

  test('a board-plays deal splits every time, which is the whole point of it', () => {
    const random = cycler(0.0537);
    for (let i = 0; i < 120; i++) {
      const puzzle = dealShowdown({ hands: 4, kind: 'board' }, random);
      const read = solveShowdown(puzzle.board, puzzle.hands);
      expect(read.winners).toEqual([0, 1, 2, 3]);
      expect(read.hands[0].category).toBe('straight');
    }
  });

  test('a kicker deal leaves every hand the same pair', () => {
    const random = cycler(0.0219);
    for (let i = 0; i < 80; i++) {
      const puzzle = dealShowdown({ hands: 3, kind: 'kicker' }, random);
      const ranks = puzzle.hands.map((hole) => hole[0][0]);
      expect(new Set(ranks).size).toBe(1);
      expect(puzzle.board.map((c) => c[0])).toContain(ranks[0]);
    }
  });

  test('difficulty ramps: more hands, then harder shapes, and it never goes back', () => {
    let hands = 0;
    const seen = new Set<ShowdownKind>();
    for (let streak = 0; streak < 40; streak++) {
      const shape = shapeFor(streak);
      expect(shape.hands).toBeGreaterThanOrEqual(hands);
      hands = shape.hands;
      seen.add(shape.kind);
    }
    expect(shapeFor(0)).toEqual({ hands: 2, kind: 'random' });
    expect([...seen].sort()).toEqual([...KINDS].sort());
    expect(showdownLevelFor(0)).toBe(0);
    expect(showdownLevelFor(1000)).toBe(SHOWDOWN_MAX_LEVEL);
  });
});

describe('the preflop generator', () => {
  test('the answer is the one the chart gives', () => {
    const random = cycler(0.0731);
    for (let i = 0; i < 400; i++) {
      const puzzle = dealPreflop(i % (PREFLOP_MAX_LEVEL + 1), random);
      const regions = regionsOf(chartFor(puzzle.bucket, puzzle.spot));
      const p = percentileOf(puzzle.hand);
      const region = regions[puzzle.best];
      expect(region).toBeDefined();
      expect(p).toBeGreaterThanOrEqual(region![0]);
      expect(p).toBeLessThanOrEqual(region![1]);
      expect(gradePreflop(puzzle, puzzle.best).right).toBe(true);
      expect(gradePreflop(puzzle, puzzle.best).evLost).toBe(0);
    }
  });

  test('the offered choices are exactly the regions the spot has', () => {
    const random = cycler(0.0611);
    for (let i = 0; i < 200; i++) {
      const puzzle = dealPreflop(0, random);
      const regions = regionsOf(chartFor(puzzle.bucket, puzzle.spot));
      expect(puzzle.choices).toEqual((['aggr', 'passive', 'fold'] as Action[]).filter((a) => regions[a]));
      expect(puzzle.choices).toContain('fold');
      expect(puzzle.choices).toContain(puzzle.best);
    }
  });

  test('the stack shown is one that lands in the bucket it names', () => {
    const random = cycler(0.0457);
    for (let i = 0; i < 200; i++) {
      const puzzle = dealPreflop(0, random);
      expect(bucketFor(puzzle.effectiveBb)).toBe(puzzle.bucket);
    }
  });

  test('the two cards shown are the hand class they claim to be', () => {
    const random = cycler(0.0289);
    for (const hand of ALL_CLASSES) {
      const [a, b] = cardsFor(hand, random);
      expect(a).not.toBe(b);
      expect(a[0]).toBe(hand[0]);
      expect(b[0]).toBe(hand[1]);
      if (hand.length === 3) expect(a[1] === b[1]).toBe(hand[2] === 's');
      else expect(a[1]).not.toBe(b[1]);
    }
  });

  test('difficulty ramps: the window round a boundary only narrows', () => {
    for (let level = 1; level <= PREFLOP_MAX_LEVEL; level++) {
      expect(windowFor(level)).toBeLessThan(windowFor(level - 1));
    }
    const easy = averageDistance(0);
    const hard = averageDistance(PREFLOP_MAX_LEVEL);
    expect(hard).toBeLessThan(easy);
    expect(hard).toBeLessThanOrEqual(windowFor(PREFLOP_MAX_LEVEL));
  });

  test('the grid it reveals covers all 169 classes and agrees with the answer', () => {
    const puzzle = dealPreflop(0, cycler(0.0173));
    const grid = gridFor(puzzle.bucket, puzzle.spot);
    const flat = grid.flat();
    expect(flat).toHaveLength(169);
    expect(new Set(flat.map((c) => c.hand)).size).toBe(169);
    expect(flat.find((c) => c.hand === puzzle.hand)?.region).toBe(puzzle.best);
  });
});

function averageDistance(level: number): number {
  const random = cycler(0.0197, level / 10);
  let total = 0;
  const runs = 300;
  for (let i = 0; i < runs; i++) {
    const puzzle = dealPreflop(level, random);
    total += distanceToBoundary(puzzle.bucket, puzzle.spot, puzzle.hand);
  }
  return total / runs;
}

describe('the record kept in localStorage', () => {
  test('a streak grows and resets, and only right answers count towards the day', () => {
    let store = emptyPuzzles();
    store = afterAnswer(store, 'showdown', true);
    store = afterAnswer(store, 'showdown', true);
    store = afterAnswer(store, 'preflop', false);
    expect(store.types.showdown).toEqual({ right: 2, total: 2, streak: 2, best: 2 });
    expect(store.types.preflop).toEqual({ right: 0, total: 1, streak: 0, best: 0 });
    expect(store.solvedToday).toBe(2);
    store = afterAnswer(store, 'showdown', false);
    expect(store.types.showdown).toEqual({ right: 2, total: 3, streak: 0, best: 2 });
    expect(store.solvedToday).toBe(2);
  });

  test('the daily count rolls over but the streaks do not', () => {
    const yesterday = new Date(2026, 0, 1);
    const now = new Date(2026, 0, 2);
    let store = afterAnswer(emptyPuzzles(), 'hand', true, yesterday);
    expect(store.solvedToday).toBe(1);
    store = afterAnswer(store, 'hand', true, now);
    expect(store.day).toBe(today(now));
    expect(store.solvedToday).toBe(1);
    expect(store.types.hand.streak).toBe(2);
  });

  test('a broken or missing record reads as an empty one', () => {
    expect(parsePuzzles(null)).toEqual(emptyPuzzles());
    expect(parsePuzzles('not json')).toEqual(emptyPuzzles());
    expect(parsePuzzles('{"types":{"showdown":{"right":"x"}}}').types.showdown.right).toBe(0);
  });
});
