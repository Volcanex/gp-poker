/* @vitest-environment jsdom
   Only this file needs a DOM: applying a setting is stamping three attributes
   on the root element, and that is worth testing against a real one. */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFS, PREFS_KEY, applyPrefs, contrastOf, contrastRatio, parseColour, readPrefs,
  writePrefs,
} from '../ui/prefs.ts';
import { denominate } from '../table/chips.ts';
import { shortName } from '../table/labels.ts';
import { avatarSeed } from '../net/adapt.ts';

/* A tiny stand-in for localStorage, so the tests do not need a browser and can
   say what a browser with storage switched off does. */
function fakeStore(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => { map.delete(k); },
    setItem: (k: string, v: string) => { map.set(k, v); },
  } as Storage;
}

const throwingStore = (): Storage => ({
  get length(): number { throw new Error('denied'); },
  clear: () => { throw new Error('denied'); },
  getItem: () => { throw new Error('denied'); },
  key: () => { throw new Error('denied'); },
  removeItem: () => { throw new Error('denied'); },
  setItem: () => { throw new Error('denied'); },
} as unknown as Storage);

describe('settings persistence', () => {
  it('round trips a choice', () => {
    const store = fakeStore();
    writePrefs({ theme: 'light', accent: 'jade', fourColour: true }, store);
    expect(readPrefs(store)).toEqual({ theme: 'light', accent: 'jade', fourColour: true });
  });

  it('keeps everything in one key', () => {
    const store = fakeStore();
    writePrefs({ theme: 'system', accent: 'clay', fourColour: false }, store);
    expect(store.getItem(PREFS_KEY)).toBe('{"theme":"system","accent":"clay","fourColour":false}');
  });

  it('takes the defaults when nothing has been chosen', () => {
    expect(readPrefs(fakeStore())).toEqual(DEFAULT_PREFS);
  });

  /* A record written by an older build, or half of one, is not a reason to
     show an error page. Whatever reads is kept and the rest defaults. */
  it('keeps the fields it can read out of a stale record', () => {
    const store = fakeStore({ [PREFS_KEY]: '{"accent":"violet","theme":"chartreuse"}' });
    expect(readPrefs(store)).toEqual({ theme: 'dark', accent: 'violet', fourColour: false });
  });

  it('survives a value that is not json at all', () => {
    expect(readPrefs(fakeStore({ [PREFS_KEY]: 'not json' }))).toEqual(DEFAULT_PREFS);
  });

  it('survives a browser that refuses storage', () => {
    expect(readPrefs(throwingStore())).toEqual(DEFAULT_PREFS);
    expect(() => writePrefs(DEFAULT_PREFS, throwingStore())).not.toThrow();
  });
});

describe('applying settings', () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = document.createElement('html');
  });

  it('leaves the attributes off for the defaults, because dark and slate are the defaults', () => {
    applyPrefs(DEFAULT_PREFS, root, fakeStore());
    expect(root.getAttribute('data-theme')).toBe(null);
    expect(root.getAttribute('data-accent')).toBe(null);
    expect(root.getAttribute('data-deck')).toBe(null);
  });

  it('stamps one attribute per choice', () => {
    applyPrefs({ theme: 'light', accent: 'ocean', fourColour: true }, root, fakeStore());
    expect(root.getAttribute('data-theme')).toBe('light');
    expect(root.getAttribute('data-accent')).toBe('ocean');
    expect(root.getAttribute('data-deck')).toBe('four');
  });

  /* g-ui reads its own key at load. The one call that changes the theme writes
     both, so the two cannot disagree on the next reload. */
  it('writes the theme where g-ui will look for it', () => {
    const store = fakeStore();
    applyPrefs({ theme: 'system', accent: 'default', fourColour: false }, root, store);
    expect(store.getItem('g-theme')).toBe('system');
  });
});

describe('contrast', () => {
  it('measures black on white the way the spec does', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrastRatio([255, 255, 255], [255, 255, 255])).toBeCloseTo(1, 5);
  });

  /* g's palette is display-p3 and this app's accents are hex, so a contrast
     check has to read both without converting one into the other badly. White
     on black is 21:1 in any colour space. */
  it('measures a display-p3 colour where it is', () => {
    expect(contrastOf('color(display-p3 1 1 1)', 'color(display-p3 0 0 0)')).toBeCloseTo(21, 2);
    expect(contrastOf('color(display-p3 1 1 1)', '#000000')).toBeCloseTo(21, 2);
    expect(contrastOf('nonsense', '#000')).toBe(null);
  });

  it('reads both shapes a browser hands back', () => {
    expect(parseColour('rgb(46, 125, 100)')).toEqual([46, 125, 100]);
    expect(parseColour('rgba(46, 125, 100, 0.5)')).toEqual([46, 125, 100]);
    expect(parseColour('#2e7d64')).toEqual([46, 125, 100]);
    expect(parseColour('#fff')).toEqual([255, 255, 255]);
    expect(parseColour('transparent')).toBe(null);
  });
});

describe('chips', () => {
  it('makes change the way a dealer does, highest first', () => {
    expect(denominate(52)).toEqual([{ value: 25, count: 2 }, { value: 1, count: 2 }]);
    expect(denominate(137)).toEqual([
      { value: 100, count: 1 }, { value: 25, count: 1 },
      { value: 5, count: 2 }, { value: 1, count: 2 },
    ]);
  });

  it('has nothing to draw for nothing', () => {
    expect(denominate(0)).toEqual([]);
    expect(denominate(-5)).toEqual([]);
    expect(denominate(Number.NaN)).toEqual([]);
  });

  it('uses the big chips for a big stack', () => {
    expect(denominate(1200)).toEqual([{ value: 500, count: 2 }, { value: 100, count: 2 }]);
  });

  /* The claim the felt's reserved height rests on: greedy over these five
     denominations never stacks more than four of anything under 500. */
  it('never builds a column deeper than four below the top denomination', () => {
    for (let n = 1; n <= 1200; n += 1) {
      for (const col of denominate(n)) {
        if (col.value !== 500) expect(col.count).toBeLessThanOrEqual(4);
      }
    }
  });
});

describe('names', () => {
  it('leaves a name that fits alone', () => {
    expect(shortName('kestrel')).toBe('kestrel');
    expect(shortName('RedTiger')).toBe('RedTiger');
  });

  /* Generated names are CamelCase, so the cut goes on a word boundary: the
     first word is what tells two players apart. */
  it('drops whole words rather than cutting one in half', () => {
    expect(shortName('StealthyCyclone', 12)).toBe('Stealthy…');
    expect(shortName('RedTigerOfTheNorth', 12)).toBe('RedTigerOf…');
  });

  it('falls back to a plain cut for a name with no words in it', () => {
    expect(shortName('aaaaaaaaaaaaaaaaaa', 12)).toBe('aaaaaaaaaaaa…');
  });
});

describe('avatar seeds', () => {
  it('prefers the id, because a name can be claimed and changed', () => {
    expect(avatarSeed('u-7', 'kestrel')).toBe('u-7');
  });

  it('falls back to the name for a payload that carries no id yet', () => {
    expect(avatarSeed(undefined, 'kestrel')).toBe('kestrel');
    expect(avatarSeed('', 'kestrel')).toBe('kestrel');
  });
});
