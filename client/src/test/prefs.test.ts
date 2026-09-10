/* @vitest-environment jsdom
   Only this file needs a DOM: applying a setting is stamping three attributes
   on the root element, and that is worth testing against a real one. */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CARD_LAYOUTS, CARD_SIZES, DEFAULT_PREFS, PALETTES, PREFS_KEY, TABLE_INFO, applyPrefs,
  contrastOf, contrastRatio, defaultAccentFor, parseColour, readPrefs, writePrefs,
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
    writePrefs({
      theme: 'light', palette: 'felt', accent: 'jade', fourColour: true, hand: 'left',
      cards: 'ajar', cardSize: 'huge', seatCards: 'regular', seatDetail: 'detailed', tableInfo: 'seat',
      handMeta: 'acts', keyLegend: false, gamePanel: 'shut',
    }, store);
    expect(readPrefs(store)).toEqual({
      theme: 'light', palette: 'felt', accent: 'jade', fourColour: true, hand: 'left',
      cards: 'ajar', cardSize: 'huge', seatCards: 'regular', seatDetail: 'detailed', tableInfo: 'seat',
      handMeta: 'acts', keyLegend: false, gamePanel: 'shut',
    });
  });

  it('keeps everything in one key', () => {
    const store = fakeStore();
    writePrefs({
      theme: 'system', palette: 'sky', accent: 'clay', fourColour: false, hand: 'right',
      cards: 'side', cardSize: 'regular', seatCards: 'huge', seatDetail: 'normal', tableInfo: 'seat',
      handMeta: 'cards', keyLegend: true, gamePanel: 'open',
    }, store);
    expect(store.getItem(PREFS_KEY)).toBe(
      '{"theme":"system","palette":"sky","accent":"clay","fourColour":false,"hand":"right"'
      + ',"cards":"side","cardSize":"regular","seatCards":"huge","seatDetail":"normal","tableInfo":"seat"'
      + ',"handMeta":"cards","keyLegend":true,"gamePanel":"open"}',
    );
  });

  it('takes the defaults when nothing has been chosen', () => {
    expect(readPrefs(fakeStore())).toEqual(DEFAULT_PREFS);
  });

  /* A record written by an older build, or half of one, is not a reason to
     show an error page. Whatever reads is kept and the rest defaults. */
  it('keeps the fields it can read out of a stale record', () => {
    const store = fakeStore({
      [PREFS_KEY]: '{"accent":"violet","theme":"chartreuse","palette":"tartan"}',
    });
    expect(readPrefs(store)).toEqual({
      theme: 'room', palette: 'slate', accent: 'violet', fourColour: false, hand: 'right',
      cards: 'stacked', cardSize: 'large', seatCards: 'large', seatDetail: 'normal', tableInfo: 'panel',
      handMeta: 'cards', keyLegend: true, gamePanel: 'open',
    });
  });

  /* The two card settings are the newest keys here, so every stored record
     written before them is a record that has neither, and the defaults have to
     be the ones the band was drawing for those players anyway. A value this
     build does not know is the same case as a missing one. */
  it('takes stacked and large for a record written before the cards had settings', () => {
    const store = fakeStore({ [PREFS_KEY]: '{"theme":"dark","hand":"left"}' });
    expect(readPrefs(store)).toMatchObject({ cards: 'stacked', cardSize: 'large' });
  });

  it('refuses a layout or a size it does not draw', () => {
    const store = fakeStore({ [PREFS_KEY]: '{"cards":"fanned","cardSize":"enormous"}' });
    expect(readPrefs(store)).toMatchObject({ cards: 'stacked', cardSize: 'large' });
  });

  it('refuses a hand info placement it does not draw', () => {
    const store = fakeStore({ [PREFS_KEY]: '{"tableInfo":"sidebar"}' });
    expect(readPrefs(store)).toMatchObject({ tableInfo: 'panel' });
  });

  /* The three newest keys, and the same bargain: a record written before them
     is a record without them, and the defaults have to be what the table was
     drawing for those players. Your line under your cards, the legend shown,
     the game panel open. */
  it('takes the defaults for a record written before the newest three', () => {
    const store = fakeStore({ [PREFS_KEY]: '{"theme":"dark"}' });
    expect(readPrefs(store)).toMatchObject({
      handMeta: 'cards', keyLegend: true, gamePanel: 'open',
    });
  });

  it('refuses a line placement or a panel state it does not draw', () => {
    const store = fakeStore({
      [PREFS_KEY]: '{"handMeta":"felt","keyLegend":"yes","gamePanel":"ajar"}',
    });
    expect(readPrefs(store)).toMatchObject({
      handMeta: 'cards', keyLegend: true, gamePanel: 'open',
    });
  });

  it('reads back every layout and every size it offers', () => {
    for (const c of CARD_LAYOUTS) {
      const store = fakeStore();
      writePrefs({ ...DEFAULT_PREFS, cards: c.id }, store);
      expect(readPrefs(store).cards).toBe(c.id);
    }
    for (const s of CARD_SIZES) {
      const store = fakeStore();
      writePrefs({ ...DEFAULT_PREFS, cardSize: s.id }, store);
      expect(readPrefs(store).cardSize).toBe(s.id);
    }
    for (const t of TABLE_INFO) {
      const store = fakeStore();
      writePrefs({ ...DEFAULT_PREFS, tableInfo: t.id }, store);
      expect(readPrefs(store).tableInfo).toBe(t.id);
    }
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

  /* The games room is the default theme and the one attribute a fresh visitor
     wears; everything else defaults to its absence. */
  it('stamps only the theme for the defaults, because the room is the default', () => {
    applyPrefs(DEFAULT_PREFS, root, fakeStore());
    expect(root.getAttribute('data-theme')).toBe('room');
    expect(root.getAttribute('data-palette')).toBe(null);
    expect(root.getAttribute('data-accent')).toBe(null);
    expect(root.getAttribute('data-deck')).toBe(null);
    expect(root.getAttribute('data-hand')).toBe(null);
    /* Stacked and large are the defaults, so they are absences too: a player
       who has chosen nothing carries no card attributes at all. */
    expect(root.getAttribute('data-cards')).toBe(null);
    expect(root.getAttribute('data-card-size')).toBe(null);
    /* Panel is the default placement for the hand's own facts and the
       match's actions, so it too is an absence. */
    expect(root.getAttribute('data-table-info')).toBe(null);
  });

  it('leaves the attributes off for dark and slate, which are the absences', () => {
    applyPrefs({ ...DEFAULT_PREFS, theme: 'dark' }, root, fakeStore());
    expect(root.getAttribute('data-theme')).toBe(null);
    expect(root.getAttribute('data-palette')).toBe(null);
    expect(root.getAttribute('data-accent')).toBe(null);
  });

  /* The room carries its own set: a stored palette and accent stay in the
     record but are not worn, and come back with the next theme. */
  it('keeps a palette and an accent off while the room is on', () => {
    const chosen = { ...DEFAULT_PREFS, palette: 'sky', accent: 'violet' } as const;
    applyPrefs(chosen, root, fakeStore());
    expect(root.getAttribute('data-theme')).toBe('room');
    expect(root.getAttribute('data-palette')).toBe(null);
    expect(root.getAttribute('data-accent')).toBe(null);

    applyPrefs({ ...chosen, theme: 'light' }, root, fakeStore());
    expect(root.getAttribute('data-palette')).toBe('sky');
    expect(root.getAttribute('data-accent')).toBe('violet');

    applyPrefs(chosen, root, fakeStore());
    expect(root.getAttribute('data-palette')).toBe(null);
    expect(root.getAttribute('data-accent')).toBe(null);
  });

  it('stamps one attribute per choice', () => {
    applyPrefs(
      {
        theme: 'light', palette: 'felt', accent: 'ocean', fourColour: true, hand: 'left',
        cards: 'side', cardSize: 'huge', seatCards: 'huge', seatDetail: 'detailed', tableInfo: 'seat',
        handMeta: 'acts', keyLegend: false, gamePanel: 'shut',
      },
      root, fakeStore(),
    );
    expect(root.getAttribute('data-theme')).toBe('light');
    expect(root.getAttribute('data-palette')).toBe('felt');
    expect(root.getAttribute('data-accent')).toBe('ocean');
    expect(root.getAttribute('data-deck')).toBe('four');
    expect(root.getAttribute('data-hand')).toBe('left');
    expect(root.getAttribute('data-seat-detail')).toBe('detailed');
    expect(root.getAttribute('data-cards')).toBe('side');
    expect(root.getAttribute('data-card-size')).toBe('huge');
    expect(root.getAttribute('data-table-info')).toBe('seat');
    expect(root.getAttribute('data-hand-meta')).toBe('acts');
    expect(root.getAttribute('data-key-legend')).toBe('off');
    expect(root.getAttribute('data-game-panel')).toBe('shut');
  });

  /* The default is the absent attribute for all three, the way every other
     setting here works: the stylesheet's bare `:root` is the default state and
     nothing has to be written for a player who has chosen nothing. */
  it('leaves the newest three unstamped at their defaults', () => {
    applyPrefs(DEFAULT_PREFS, root, fakeStore());
    expect(root.getAttribute('data-hand-meta')).toBe(null);
    expect(root.getAttribute('data-key-legend')).toBe(null);
    expect(root.getAttribute('data-game-panel')).toBe(null);
  });

  /* Right handed is the default, so it is the absence of the attribute: a
     record that says so must clear one an earlier choice left behind. */
  it('clears the handedness attribute when the choice goes back to right', () => {
    applyPrefs({ ...DEFAULT_PREFS, theme: 'dark', hand: 'left' }, root, fakeStore());
    applyPrefs(DEFAULT_PREFS, root, fakeStore());
    expect(root.getAttribute('data-hand')).toBe(null);
  });

  /* Same bargain for the cards: the band's height is derived from these two,
     so an attribute left behind by an earlier choice is a band the wrong size
     for the setting the player is actually on. */
  it('clears the card attributes when the choice goes back to the defaults', () => {
    applyPrefs({ ...DEFAULT_PREFS, cards: 'ajar', cardSize: 'regular' }, root, fakeStore());
    expect(root.getAttribute('data-cards')).toBe('ajar');
    expect(root.getAttribute('data-card-size')).toBe('regular');
    applyPrefs(DEFAULT_PREFS, root, fakeStore());
    expect(root.getAttribute('data-cards')).toBe(null);
    expect(root.getAttribute('data-card-size')).toBe(null);
  });

  /* `table.tsx` reads this one itself (`useTableInfo`), not just a
     stylesheet, so a stale attribute is a component reading the wrong
     placement rather than a wrong pixel. */
  it('clears the table info attribute when the choice goes back to the default', () => {
    applyPrefs({ ...DEFAULT_PREFS, tableInfo: 'seat' }, root, fakeStore());
    expect(root.getAttribute('data-table-info')).toBe('seat');
    applyPrefs(DEFAULT_PREFS, root, fakeStore());
    expect(root.getAttribute('data-table-info')).toBe(null);
  });

  /* g-ui reads its own key at load. The one call that changes the theme writes
     both, so the two cannot disagree on the next reload. */
  it('writes the theme where g-ui will look for it', () => {
    const store = fakeStore();
    applyPrefs({ ...DEFAULT_PREFS, theme: 'system' }, root, store);
    expect(store.getItem('g-theme')).toBe('system');
  });
});

/* The rule the settings menu applies when a palette changes. It lives in
   prefs.ts because "which accent did this palette arrive with" is the only way
   to tell a chosen accent from a default one without a second stored flag. */
describe('palette defaults', () => {
  it('names an accent for every palette', () => {
    for (const p of PALETTES) expect(defaultAccentFor(p.id)).toBe(p.accent);
  });

  it('leaves slate on the g accent', () => {
    expect(defaultAccentFor('slate')).toBe('default');
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
