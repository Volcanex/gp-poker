import { describe, expect, it } from 'vitest';
import { pageEnters } from '../ui/enter.tsx';

/* The one decision the page entrance makes in JavaScript: whether a route
   takes it at all. Everything else is CSS. The table and everything reached
   from a match link are out, because they hold one footprint through a hand
   and the footprint suite measures it. */
describe('pageEnters', () => {
  it('lets the ordinary pages enter', () => {
    for (const path of [
      '/', '/arena', '/arena/a-1', '/leaderboard', '/watch', '/learn', '/learn/odds',
      '/puzzles', '/puzzles/hand', '/tools', '/tools/ranges', '/u/kestrel', '/c/ch-open',
      '/g/hg-open', '/nowhere',
    ]) {
      expect(pageEnters(path), path).toBe(true);
    }
  });

  it('keeps the table, the match summary and the replay out', () => {
    for (const path of ['/m', '/m/mock', '/m/qtabzev9', '/m/qtabzev9/h/4']) {
      expect(pageEnters(path), path).toBe(false);
    }
  });

  it('does not read a match out of a path that merely starts with the letter', () => {
    for (const path of ['/mode', '/matches', '/my']) {
      expect(pageEnters(path), path).toBe(true);
    }
  });
});
