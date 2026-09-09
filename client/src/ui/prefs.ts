/* What the player has chosen about how the table looks. Four settings, one
   record, one key.

   Every one of them is applied as an attribute on the root element and the
   values live in CSS, which is why this file holds no colours: an accent is
   `data-accent="jade"`, and `app.css` says what jade is. That keeps the
   pre-paint script in index.html down to three attribute writes, with nothing
   to drift out of step with the stylesheet. */

/* `room` is the games room, in ../room.css: a whole coordinated set rather
   than a palette plus an accent, and the default for a visitor who has chosen
   nothing. While it is on, the stored palette and accent are kept but not
   worn, so they come back when another theme is chosen. */
export type ThemeChoice = 'room' | 'dark' | 'light' | 'system';
export type AccentId = 'default' | 'ocean' | 'jade' | 'violet' | 'clay' | 'ember';
export type PaletteId = 'slate' | 'felt' | 'sky' | 'umber';
/* Which hand holds the phone. The v2 table's action band puts the controls
   under the thumb and the cards on the far side, so it has to be told which
   edge the thumb is on. Right is the default because most people are. */
export type Handedness = 'right' | 'left';

/* How the two cards in your own hand are laid out on the band, and how big
   they are drawn. Both are geometry and both live in `../table/hero-band.css`:
   a layout is a width in card widths, a peek and a tilt, and a size is one
   number the band's own height is derived from. Nothing here knows a pixel.

   Stacked is the default because it is how a player holds two cards: one card
   in front, read whole, and the one behind it out far enough to read its
   index. Ajar is the fan this replaced, kept because some people prefer it. */
export type CardLayout = 'stacked' | 'side' | 'ajar';
export type CardSize = 'regular' | 'large' | 'huge';

export interface Prefs {
  theme: ThemeChoice;
  palette: PaletteId;
  accent: AccentId;
  fourColour: boolean;
  hand: Handedness;
  cards: CardLayout;
  cardSize: CardSize;
  /* How big everybody else's cards are drawn in their seat. Its own choice
     rather than a second reading of `cardSize`: your own two cards are the
     hand you are playing and the other five seats are a table you are
     watching, and somebody who wants their own hand huge does not
     necessarily want five more pairs that size on the felt. */
  seatCards: CardSize;
}

export const PREFS_KEY = 'ot.prefs';

export const DEFAULT_PREFS: Prefs = {
  theme: 'room', palette: 'slate', accent: 'default', fourColour: false, hand: 'right',
  cards: 'stacked', cardSize: 'large', seatCards: 'large',
};

export const THEMES: { id: ThemeChoice; label: string }[] = [
  { id: 'room', label: 'Games room' },
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'system', label: 'System' },
];

/* Names, not colours. The swatch in the menu carries the same data-accent as
   the root does and takes its colour from the same rule. */
export const ACCENTS: { id: AccentId; label: string }[] = [
  { id: 'default', label: 'Slate' },
  { id: 'ocean', label: 'Ocean' },
  { id: 'jade', label: 'Jade' },
  { id: 'violet', label: 'Violet' },
  { id: 'clay', label: 'Clay' },
  { id: 'ember', label: 'Ember' },
];

/* A palette is the twelve greys the whole site is built out of, felt included,
   and each one arrives wearing an accent that suits it. Names and ids only:
   what felt is, is in ../palettes.css, and the chip in the menu carries the
   same data-palette and takes the same colours. */
export const PALETTES: { id: PaletteId; label: string; accent: AccentId }[] = [
  { id: 'slate', label: 'Slate', accent: 'default' },
  { id: 'felt', label: 'Felt', accent: 'ember' },
  { id: 'sky', label: 'Sky', accent: 'ocean' },
  { id: 'umber', label: 'Umber', accent: 'clay' },
];

export function defaultAccentFor(palette: PaletteId): AccentId {
  return PALETTES.find((p) => p.id === palette)?.accent ?? 'default';
}

const isTheme = (v: unknown): v is ThemeChoice =>
  v === 'room' || v === 'dark' || v === 'light' || v === 'system';

const isAccent = (v: unknown): v is AccentId =>
  typeof v === 'string' && ACCENTS.some((a) => a.id === v);

const isHand = (v: unknown): v is Handedness => v === 'right' || v === 'left';

export const CARD_LAYOUTS: { id: CardLayout; label: string }[] = [
  { id: 'stacked', label: 'Stacked' },
  { id: 'side', label: 'Side by side' },
  { id: 'ajar', label: 'Ajar' },
];

export const CARD_SIZES: { id: CardSize; label: string }[] = [
  { id: 'regular', label: 'Regular' },
  { id: 'large', label: 'Large' },
  { id: 'huge', label: 'Huge' },
];

const isCardLayout = (v: unknown): v is CardLayout =>
  typeof v === 'string' && CARD_LAYOUTS.some((c) => c.id === v);

const isCardSize = (v: unknown): v is CardSize =>
  typeof v === 'string' && CARD_SIZES.some((c) => c.id === v);

const isPalette = (v: unknown): v is PaletteId =>
  typeof v === 'string' && PALETTES.some((p) => p.id === v);

/* A stored record from an older build, a half-written one, or a browser with
   storage switched off all mean the same thing: take the defaults for whatever
   is missing and keep whatever reads. A settings menu is not worth an error. */
export function readPrefs(store: Storage | null = safeStorage()): Prefs {
  if (!store) return { ...DEFAULT_PREFS };
  let raw: unknown;
  try {
    raw = JSON.parse(store.getItem(PREFS_KEY) ?? 'null');
  } catch {
    return { ...DEFAULT_PREFS };
  }
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PREFS };
  const r = raw as Partial<Prefs>;
  return {
    theme: isTheme(r.theme) ? r.theme : DEFAULT_PREFS.theme,
    palette: isPalette(r.palette) ? r.palette : DEFAULT_PREFS.palette,
    accent: isAccent(r.accent) ? r.accent : DEFAULT_PREFS.accent,
    fourColour: typeof r.fourColour === 'boolean' ? r.fourColour : DEFAULT_PREFS.fourColour,
    hand: isHand(r.hand) ? r.hand : DEFAULT_PREFS.hand,
    cards: isCardLayout(r.cards) ? r.cards : DEFAULT_PREFS.cards,
    cardSize: isCardSize(r.cardSize) ? r.cardSize : DEFAULT_PREFS.cardSize,
    seatCards: isCardSize(r.seatCards) ? r.seatCards : DEFAULT_PREFS.seatCards,
  };
}

export function writePrefs(prefs: Prefs, store: Storage | null = safeStorage()): void {
  if (!store) return;
  try {
    store.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* private browsing, or a full quota. The session keeps the choice. */
  }
}

/* g-ui reads its own `g-theme` key at load and stamps `data-theme` itself, so
   the theme is written in both places by the one call that changes it. They
   cannot drift: nothing else in this app calls g.theme(). */
export function applyPrefs(prefs: Prefs, root: HTMLElement, store: Storage | null = safeStorage()): void {
  const g = (window as { g?: { theme?: (m: ThemeChoice) => void } }).g;
  if (g?.theme) {
    g.theme(prefs.theme);
  } else {
    if (prefs.theme === 'dark') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', prefs.theme);
    try {
      store?.setItem('g-theme', prefs.theme);
    } catch {
      /* see writePrefs */
    }
  }

  /* The room carries its own set, so neither attribute goes on while it is
     the theme; room.css would win over them in the cascade anyway, and the
     settings menu hides both rows. */
  const room = prefs.theme === 'room';
  if (room || prefs.palette === 'slate') root.removeAttribute('data-palette');
  else root.setAttribute('data-palette', prefs.palette);

  if (room || prefs.accent === 'default') root.removeAttribute('data-accent');
  else root.setAttribute('data-accent', prefs.accent);

  if (prefs.fourColour) root.setAttribute('data-deck', 'four');
  else root.removeAttribute('data-deck');

  if (prefs.hand === 'left') root.setAttribute('data-hand', 'left');
  else root.removeAttribute('data-hand');

  /* Two attributes rather than one, because they are two independent choices:
     a layout is where the second card sits and a size is how big both are. The
     default of each is the absent attribute, the way every other setting here
     works, so a player who has chosen nothing carries no attributes at all. */
  if (prefs.cards === 'stacked') root.removeAttribute('data-cards');
  else root.setAttribute('data-cards', prefs.cards);

  if (prefs.cardSize === 'large') root.removeAttribute('data-card-size');
  else root.setAttribute('data-card-size', prefs.cardSize);

  if (prefs.seatCards === 'large') root.removeAttribute('data-seat-cards');
  else root.setAttribute('data-seat-cards', prefs.seatCards);
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/* WCAG relative luminance and contrast, used by the e2e suite to check every
   accent against the text that sits on it, in both themes. The values it reads
   are the ones the stylesheet actually ships, so this cannot pass on a colour
   nobody sees. */
export function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/* Relative luminance from any of the three notations a browser hands back.
   g's own palette is declared in display-p3, and this app's accents in hex, so
   both turn up: p3 is not converted to sRGB and then measured, it is measured
   where it is, using the luminance row of the P3 to XYZ matrix. Same number,
   none of the round trip. */
const P3_TO_Y = [0.2289745640697488, 0.6917385218365064, 0.079286914093745];

const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

export function luminance(css: string): number | null {
  const p3 = css.trim().match(/^color\(\s*display-p3\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i);
  if (p3) {
    const [r, g, b] = [1, 2, 3].map((i) => linear(Number(p3[i])));
    return P3_TO_Y[0] * r + P3_TO_Y[1] * g + P3_TO_Y[2] * b;
  }
  const rgb = parseColour(css);
  return rgb == null ? null : relativeLuminance(rgb);
}

export function contrastOf(a: string, b: string): number | null {
  const la = luminance(a);
  const lb = luminance(b);
  if (la == null || lb == null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/* "rgb(46, 125, 100)" or "#2e7d64", which is what getComputedStyle gives back
   for a colour declared in either. */
export function parseColour(value: string): [number, number, number] | null {
  const text = value.trim();
  const rgb = text.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!hex) return null;
  const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}
