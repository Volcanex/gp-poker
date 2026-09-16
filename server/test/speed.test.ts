import { describe, expect, it } from 'vitest';
import {
  BADGES,
  HEADS_UP_STANDARD,
  HEADS_UP_FAST,
  SIX_MAX_STANDARD,
  SIX_MAX_FAST,
  badgesFor,
  blindsAt,
  ceilingFor,
  formatFor,
  levelAt,
  levelFor,
  levelProgress,
  levelThreshold,
  matchCeilingMs,
  speedOf,
  terminalLevelMs,
  type MatchFormat,
} from '@opentable/protocol';

/* The schedules, the level curve and the badges. All three are pure, all
   three are numbers somebody has to be able to trust, and none of them needs
   a database, so this file has neither an app nor a socket in it.

   What the schedule half is really holding is the promise the home page
   makes: a fast table is over inside twenty minutes and a standard one inside
   two hours. That promise is kept by the blinds, not by a timer, and it is
   only kept if the arithmetic in the format definitions is right. */

const FORMATS: MatchFormat[] = [HEADS_UP_FAST, SIX_MAX_FAST, HEADS_UP_STANDARD, SIX_MAX_STANDARD];

const name = (f: MatchFormat) => `${speedOf(f)} ${f.mode}`;

describe('blind schedules', () => {
  for (const format of FORMATS) {
    it(`${name(format)} cannot outlast its ceiling`, () => {
      expect(matchCeilingMs(format)).toBeLessThanOrEqual(ceilingFor(speedOf(format)));
    });

    it(`${name(format)} ends at its top level whatever anybody does`, () => {
      // The proof the ceiling rests on: at the top level the big blind is at
      // least half of every chip on the table, so no seat can post one
      // without being all-in and each hand busts somebody.
      const chips = format.stack * format.players;
      const top = format.levels[format.levels.length - 1];
      expect(top.bb * 2).toBeGreaterThanOrEqual(chips);
    });

    it(`${name(format)} climbs, never falls`, () => {
      for (let i = 1; i < format.levels.length; i++) {
        expect(format.levels[i].bb).toBeGreaterThan(format.levels[i - 1].bb);
        expect(format.levels[i].sb).toBeGreaterThan(format.levels[i - 1].sb);
      }
      expect(format.levels[0]).toEqual({ sb: format.sb, bb: format.bb });
    });
  }

  it('puts a fast six-max table inside twenty minutes', () => {
    expect(terminalLevelMs(SIX_MAX_FAST)).toBe(12 * 90 * 1_000); // thirteen levels, 90s each
    expect(matchCeilingMs(SIX_MAX_FAST)).toBeLessThanOrEqual(20 * 60_000);
    // And the last level is reached with time to spare rather than at 19:59.
    expect(matchCeilingMs(SIX_MAX_FAST)).toBeLessThan(19 * 60_000);
  });

  it('puts a fast heads-up table inside twenty minutes', () => {
    expect(terminalLevelMs(HEADS_UP_FAST)).toBe(10 * 90 * 1_000);
    expect(matchCeilingMs(HEADS_UP_FAST)).toBeLessThanOrEqual(20 * 60_000);
  });

  it('plays every heads-up match to a bust rather than to a hand count', () => {
    // No cap on either heads-up format: the schedule ends the match, which is
    // what the two tests above prove it can. A format that grew a cap again
    // would be a match decided by counting rather than by poker.
    expect(HEADS_UP_FAST.hands).toBeNull();
    expect(HEADS_UP_STANDARD.hands).toBeNull();
  });

  it('keeps a standard table inside two hours', () => {
    expect(matchCeilingMs(SIX_MAX_STANDARD)).toBeLessThanOrEqual(120 * 60_000);
    expect(matchCeilingMs(HEADS_UP_STANDARD)).toBeLessThanOrEqual(120 * 60_000);
  });

  it('gives a fast table a clock a player can play at speed with', () => {
    for (const f of [HEADS_UP_FAST, SIX_MAX_FAST]) {
      expect(f.clockMs).toBe(10_000);
      expect(f.graceMs).toBeGreaterThan(0);
      expect(f.graceMs).toBeLessThan(f.clockMs);
    }
    for (const f of [HEADS_UP_STANDARD, SIX_MAX_STANDARD]) expect(f.clockMs).toBe(30_000);
  });
});

describe('which level is in play', () => {
  it('climbs a fast schedule on the clock and not on hands', () => {
    expect(SIX_MAX_FAST.levelHands).toBe(0);
    // A hundred hands in a minute is still level 1: the hand basis is off.
    expect(levelAt(SIX_MAX_FAST, 100, 60_000)).toBe(0);
    expect(levelAt(SIX_MAX_FAST, 1, 90_000)).toBe(1);
    expect(levelAt(SIX_MAX_FAST, 1, 89_999)).toBe(0);
    expect(blindsAt(SIX_MAX_FAST, 1, 90_000)).toEqual({ sb: 2, bb: 4 });
  });

  it('takes whichever basis is further along on a long six-max table', () => {
    // Eight hands a level, and a table at a normal pace is always ahead of
    // the clock, so the hand basis is the one that leads.
    expect(levelAt(SIX_MAX_STANDARD, 9, 60_000)).toBe(1);
    // A table crawling at three hands in half an hour is pulled up by the
    // clock instead, which is the whole point of the second basis.
    expect(levelAt(SIX_MAX_STANDARD, 3, 30 * 60_000)).toBe(3);
  });

  it('climbs a standard heads-up table on hands, with the clock behind it', () => {
    // Six hands a level, so the blinds have moved four times by the hand the
    // old cap used to end the match on.
    expect(blindsAt(HEADS_UP_STANDARD, 1)).toEqual({ sb: 1, bb: 2 });
    expect(blindsAt(HEADS_UP_STANDARD, 6)).toEqual({ sb: 1, bb: 2 });
    expect(blindsAt(HEADS_UP_STANDARD, 7)).toEqual({ sb: 2, bb: 4 });
    expect(blindsAt(HEADS_UP_STANDARD, 25)).toEqual({ sb: 8, bb: 16 });
    // The top level is reached on hands alone, which is what makes a bust
    // certain without the clock having to be involved at all.
    expect(levelAt(HEADS_UP_STANDARD, 61)).toBe(HEADS_UP_STANDARD.levels.length - 1);
    // And a table crawling slower than 100 seconds a hand is pulled up by the
    // clock instead: one hand played in fifty minutes is already level 6.
    expect(levelAt(HEADS_UP_STANDARD, 1, 50 * 60_000)).toBe(5);
  });

  it('stops at the top level rather than running off the end', () => {
    expect(levelAt(SIX_MAX_FAST, 1, 10 * 60 * 60_000)).toBe(SIX_MAX_FAST.levels.length - 1);
    expect(blindsAt(SIX_MAX_FAST, 1, 10 * 60 * 60_000)).toEqual({ sb: 300, bb: 600 });
  });

  it('reads a format stored before speed existed exactly as it always did', () => {
    // No `speed`, no `levelSeconds`: the shape every match on the box has.
    const old: MatchFormat = {
      mode: 'six-max',
      players: 6,
      rated: true,
      hands: null,
      stack: 200,
      sb: 1,
      bb: 2,
      levels: [
        { sb: 1, bb: 2 },
        { sb: 2, bb: 4 },
        { sb: 3, bb: 6 },
      ],
      levelHands: 8,
      clockMs: 20_000,
      graceMs: 15_000,
    };
    expect(speedOf(old)).toBe('standard');
    expect(blindsAt(old, 1)).toEqual({ sb: 1, bb: 2 });
    expect(blindsAt(old, 9)).toEqual({ sb: 2, bb: 4 });
    // Even handed a wall clock, nothing about it moves.
    expect(blindsAt(old, 9, 5 * 60 * 60_000)).toEqual({ sb: 2, bb: 4 });
  });
});

describe('formatFor', () => {
  it('answers standard unless fast is asked for', () => {
    expect(formatFor('six-max', true)).toEqual({ ...SIX_MAX_STANDARD, rated: true });
    expect(formatFor('six-max', false, 'fast')).toEqual({ ...SIX_MAX_FAST, rated: false });
    expect(formatFor('heads-up', true, 'fast').clockMs).toBe(10_000);
  });
});

describe('the level curve', () => {
  it('needs L(L+1)/2 matches for level L', () => {
    expect(levelThreshold(0)).toBe(0);
    expect(levelThreshold(1)).toBe(1);
    expect(levelThreshold(2)).toBe(3);
    expect(levelThreshold(5)).toBe(15);
    expect(levelThreshold(10)).toBe(55);
    expect(levelThreshold(20)).toBe(210);
  });

  it('is level 0 until a match has been finished', () => {
    expect(levelFor(0)).toBe(0);
    expect(levelFor(-3)).toBe(0);
    expect(levelFor(1)).toBe(1);
  });

  it('agrees with its own thresholds at every step', () => {
    for (let level = 1; level <= 40; level++) {
      const at = levelThreshold(level);
      expect(levelFor(at)).toBe(level);
      expect(levelFor(at - 1)).toBe(level - 1);
    }
  });

  it('never goes backwards as matches are played', () => {
    let previous = 0;
    for (let matches = 0; matches <= 1000; matches++) {
      const level = levelFor(matches);
      expect(level).toBeGreaterThanOrEqual(previous);
      previous = level;
    }
  });

  it('says how far into a level somebody is', () => {
    // 15 matches is exactly level 5, so nothing is banked toward level 6.
    expect(levelProgress(15)).toEqual({ level: 5, into: 0, span: 6, toNext: 6 });
    expect(levelProgress(18)).toEqual({ level: 5, into: 3, span: 6, toNext: 3 });
    expect(levelProgress(0)).toEqual({ level: 0, into: 0, span: 1, toNext: 1 });
  });
});

describe('badges', () => {
  it('gives nothing to somebody who has played nothing', () => {
    expect(badgesFor({ matches: 0, hands: 0, sixMaxWins: 0 })).toEqual([]);
  });

  it('gives the first one for a single finished match', () => {
    expect(badgesFor({ matches: 1, hands: 4, sixMaxWins: 0 })).toEqual(['first-game']);
  });

  it('follows the level curve rather than a second set of numbers', () => {
    expect(badgesFor({ matches: levelThreshold(5), hands: 0, sixMaxWins: 0 })).toContain('level-5');
    expect(badgesFor({ matches: levelThreshold(5) - 1, hands: 0, sixMaxWins: 0 })).not.toContain('level-5');
    expect(badgesFor({ matches: levelThreshold(20), hands: 0, sixMaxWins: 0 })).toContain('level-20');
  });

  it('counts hands and six handed wins separately from matches', () => {
    expect(badgesFor({ matches: 1, hands: 100, sixMaxWins: 0 })).toContain('hundred-hands');
    expect(badgesFor({ matches: 1, hands: 99, sixMaxWins: 0 })).not.toContain('hundred-hands');
    expect(badgesFor({ matches: 1, hands: 0, sixMaxWins: 1 })).toContain('six-max-win');
  });

  it('has an entry in the table for every badge it can award', () => {
    const earned = badgesFor({ matches: 1000, hands: 5000, sixMaxWins: 40 });
    expect(earned.sort()).toEqual(BADGES.map((b) => b.id).sort());
  });
});
