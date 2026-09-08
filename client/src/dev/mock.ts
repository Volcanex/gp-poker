/* Dev-only. A scripted TableView sequence pushed through the real renderer, so
   the table can be looked at without a server. Reached at /m/mock (or any match
   URL with ?mock=1); ?step=N freezes on one moment for a screenshot, and
   ?mode=six-max runs the six-handed script instead of the heads-up one.
   Nothing here is imported by the production paths other than the match route's
   branch on that id. */
import { formatFor } from '@opentable/protocol';
import type {
  ActionKind, Card, ChatFrom, LastEvent, MatchFormat, MatchResult, Mode, SeatView, TableView,
} from '@opentable/protocol';
import { lineId, type ChatLine } from '../chat/chat.ts';

const HASH1 = 'b1f3c9a7d2e480516c4a9f0b3d7e2851aa64c3f9207d5e8b1c6f4a09d3e75b2c8';
const SEED1 = '9d4e1b7a3f02c85641d9a0e73b2c5f8e0a6d31c94b7f28e50a3d6c19f4b8e2705';
const HASH2 = '7c2a5e91d3b64f08a1c9e7d250b3f846ac1d9e05b7f3a2680c4d1e9b6a5f3072';
const HIDDEN: Card[] = ['?', '?'];

interface Player {
  uid: string;
  name: string;
  rating: number;
  bot?: boolean;
  /* One scripted player has an uploaded picture, so the table's baselines
     cover the <img> path and not only the generated avatar. The e2e stub
     answers every avatar URL with a fixture png. */
  avatarV?: number;
}

interface SeatSpec {
  stack: number;
  bet?: number;
  acting?: boolean;
  folded?: boolean;
  allin?: boolean;
  out?: boolean;
  place?: number;
  button?: boolean;
  last?: { a: ActionKind; v?: number } | null;
  cards?: Card[] | null;
  connected?: boolean;
}

interface ViewSpec {
  h?: number;
  n: number;
  street: TableView['street'];
  board: Card[];
  pot: number;
  seats: SeatSpec[];
  legal?: TableView['legal'];
  clockSeat?: number;
  last?: LastEvent | null;
  result?: TableView['result'];
  seed?: string | null;
  seedHash?: string;
}

export interface MockStep {
  delay: number; // ms to hold before the next step
  label: string;
  view?: TableView;
  end?: MatchResult;
}

function seatOf(players: Player[], i: number, you: number, hole: Card[], spec: SeatSpec): SeatView {
  const p = players[i];
  return {
    i,
    uid: p.uid,
    name: p.name,
    rating: p.rating,
    avatarV: p.avatarV ?? 0,
    stack: spec.stack,
    bet: spec.bet ?? 0,
    cards: spec.cards === undefined ? (spec.out ? null : i === you ? hole : HIDDEN) : spec.cards,
    folded: spec.folded ?? false,
    allin: spec.allin ?? false,
    button: spec.button ?? false,
    acting: spec.acting ?? false,
    connected: spec.connected ?? true,
    bot: p.bot ?? false,
    out: spec.out ?? false,
    place: spec.place ?? null,
    last: spec.last ?? null,
  };
}

function viewer(players: Player[], you: number, hole: Card[], format: MatchFormat, blindsOf: (h: number) => { sb: number; bb: number }) {
  return (spec: ViewSpec): TableView => {
    const h = spec.h ?? 1;
    return {
      m: 'mock',
      h,
      n: spec.n,
      street: spec.street,
      board: spec.board,
      pot: spec.pot,
      pots: [],
      seats: spec.seats.map((s, i) => seatOf(players, i, you, hole, s)),
      you,
      legal: spec.legal ?? null,
      clock:
        spec.clockSeat == null
          ? null
          : { seat: spec.clockSeat, deadline: Date.now() + format.clockMs, paused: false },
      seedHash: spec.seedHash ?? HASH1,
      seed: spec.seed ?? null,
      format,
      blinds: blindsOf(h),
      handsPlayed: spec.street === 'done' ? h : h - 1,
      last: spec.last ?? null,
      result: spec.result ?? null,
    };
  };
}

export function mockScript(mode: Mode = 'heads-up', rated = true, practice = false): MockStep[] {
  const steps = mode === 'six-max' ? sixMaxScript() : headsUpScript();
  /* A practice table is a casual table with the flag the client reads to show
     the analysis strip. Stamped over the finished script rather than threaded
     through both builders: the flag changes nothing about how a hand plays. */
  if (practice) {
    return steps.map((s) => ({
      ...s,
      view: s.view
        ? { ...s.view, format: { ...s.view.format, rated: false, practice: true } }
        : undefined,
      end: s.end ? { ...s.end, rated: false } : undefined,
    }));
  }
  if (rated) return steps;
  /* A casual match is rated: false with the ratings map still on it, which is
     what the server sends and what the result screen has to ignore. */
  return steps.map((s) => (s.end ? { ...s, end: { ...s.end, rated: false } } : s));
}

/* ------------------------------------------------------------- heads-up */

const HU: Player[] = [
  { uid: 'u-opp', name: 'riverrat', rating: 1642, avatarV: 1 },
  { uid: 'u-you', name: 'kestrel', rating: 1518 },
];
const OPP = 0;
const YOU = 1;
const HU_BOARD: Card[] = ['7h', '2c', 'Jh', 'Td', '4h'];
const HU_HOLE: Card[] = ['Kh', '9h'];
const HU_OPP_CARDS: Card[] = ['As', 'Qd'];
/* Hand two runs out a board that beats you, so the mock carries a showdown
   you lose as well as one you win. */
const H2_BOARD: Card[] = ['Qs', '9c', '4d', 'Qh', '2s'];
const H2_OPP_CARDS: Card[] = ['Ac', 'Qd'];

function headsUpScript(): MockStep[] {
  const format = formatFor('heads-up', true);
  const view = viewer(HU, YOU, HU_HOLE, format, () => ({ sb: format.sb, bb: format.bb }));
  const board = (n: number) => HU_BOARD.slice(0, n);

  return [
    {
      delay: 1600,
      label: 'Blinds posted, you act first preflop',
      view: view({
        n: 1, street: 'pre', board: board(0), pot: 3,
        seats: [{ stack: 198, bet: 2 }, { stack: 199, bet: 1, acting: true, button: true }],
        legal: { actions: ['f', 'c', 'r'], call: 1, min: 4, max: 200 },
        clockSeat: YOU,
        last: { k: 'deal' },
      }),
    },
    {
      delay: 1400,
      label: 'You raise to 6',
      view: view({
        n: 2, street: 'pre', board: board(0), pot: 8,
        seats: [
          { stack: 198, bet: 2, acting: true },
          { stack: 194, bet: 6, button: true, last: { a: 'r', v: 6 } },
        ],
        clockSeat: OPP,
        last: { k: 'act', seat: YOU, a: 'r', v: 6 },
      }),
    },
    {
      delay: 1200,
      label: 'Opponent calls',
      view: view({
        n: 3, street: 'pre', board: board(0), pot: 12,
        seats: [
          { stack: 194, bet: 6, last: { a: 'c', v: 4 } },
          { stack: 194, bet: 6, button: true, last: { a: 'r', v: 6 } },
        ],
        last: { k: 'act', seat: OPP, a: 'c', v: 4 },
      }),
    },
    {
      delay: 1800,
      label: 'Flop, chips are in the pot',
      view: view({
        n: 4, street: 'flop', board: board(3), pot: 12,
        seats: [{ stack: 194, acting: true }, { stack: 194, button: true }],
        clockSeat: OPP,
        last: { k: 'street' },
      }),
    },
    {
      delay: 1400,
      label: 'Opponent checks, the bar is yours',
      view: view({
        n: 5, street: 'flop', board: board(3), pot: 12,
        seats: [
          { stack: 194, last: { a: 'x' } },
          { stack: 194, acting: true, button: true },
        ],
        legal: { actions: ['x', 'b'], call: 0, min: 2, max: 194 },
        clockSeat: YOU,
        last: { k: 'act', seat: OPP, a: 'x' },
      }),
    },
    {
      delay: 1300,
      label: 'You bet 8',
      view: view({
        n: 6, street: 'flop', board: board(3), pot: 20,
        seats: [
          { stack: 194, acting: true },
          { stack: 186, bet: 8, button: true, last: { a: 'b', v: 8 } },
        ],
        clockSeat: OPP,
        last: { k: 'act', seat: YOU, a: 'b', v: 8 },
      }),
    },
    {
      delay: 1500,
      label: 'Opponent calls the flop bet',
      view: view({
        n: 7, street: 'flop', board: board(3), pot: 28,
        seats: [
          { stack: 186, bet: 8, last: { a: 'c', v: 8 } },
          { stack: 186, bet: 8, button: true, last: { a: 'b', v: 8 } },
        ],
        last: { k: 'act', seat: OPP, a: 'c', v: 8 },
      }),
    },
    {
      delay: 1600,
      label: 'Turn',
      view: view({
        n: 8, street: 'turn', board: board(4), pot: 28,
        seats: [
          { stack: 186, last: { a: 'x' } },
          { stack: 186, acting: true, button: true },
        ],
        legal: { actions: ['x', 'b'], call: 0, min: 2, max: 186 },
        clockSeat: YOU,
        last: { k: 'street' },
      }),
    },
    {
      delay: 1300,
      label: 'You bet 18 on the turn',
      view: view({
        n: 9, street: 'turn', board: board(4), pot: 46,
        seats: [
          { stack: 186, acting: true },
          { stack: 168, bet: 18, button: true, last: { a: 'b', v: 18 } },
        ],
        clockSeat: OPP,
        last: { k: 'act', seat: YOU, a: 'b', v: 18 },
      }),
    },
    {
      delay: 2000,
      label: 'Opponent raises to 52, you are facing a decision',
      view: view({
        n: 10, street: 'turn', board: board(4), pot: 98,
        seats: [
          { stack: 134, bet: 52, last: { a: 'r', v: 52 } },
          { stack: 168, bet: 18, acting: true, button: true },
        ],
        legal: { actions: ['f', 'c', 'r'], call: 34, min: 86, max: 186 },
        clockSeat: YOU,
        last: { k: 'act', seat: OPP, a: 'r', v: 52 },
      }),
    },
    {
      delay: 1600,
      label: 'You call',
      view: view({
        n: 11, street: 'turn', board: board(4), pot: 132,
        seats: [
          { stack: 134, bet: 52, last: { a: 'r', v: 52 } },
          { stack: 134, bet: 52, button: true, last: { a: 'c', v: 34 } },
        ],
        last: { k: 'act', seat: YOU, a: 'c', v: 34 },
      }),
    },
    {
      delay: 1600,
      label: 'River, opponent checks',
      view: view({
        n: 12, street: 'river', board: board(5), pot: 132,
        seats: [
          { stack: 134, last: { a: 'x' } },
          { stack: 134, acting: true, button: true },
        ],
        legal: { actions: ['x', 'b'], call: 0, min: 2, max: 134 },
        clockSeat: YOU,
        last: { k: 'street' },
      }),
    },
    {
      delay: 1400,
      label: 'You check behind',
      view: view({
        n: 13, street: 'showdown', board: board(5), pot: 132,
        seats: [
          { stack: 134, cards: HU_OPP_CARDS },
          { stack: 134, button: true, last: { a: 'x' } },
        ],
        last: { k: 'showdown', cards: HU_OPP_CARDS },
      }),
    },
    {
      delay: 2600,
      label: 'Showdown, the pot is awarded',
      view: view({
        n: 14, street: 'done', board: board(5), pot: 132,
        seats: [{ stack: 134, cards: HU_OPP_CARDS }, { stack: 266, button: true }],
        seed: SEED1,
        result: {
          awards: [{ seat: YOU, amount: 132, hand: 'flush, king high' }],
          shown: { [OPP]: HU_OPP_CARDS, [YOU]: HU_HOLE },
        },
        last: { k: 'award', seat: YOU, v: 132 },
      }),
    },
    {
      delay: 2400,
      label: 'The last hand deals',
      view: view({
        h: 25, n: 1, street: 'pre', board: [], pot: 3, seedHash: HASH2,
        seats: [
          { stack: 132, bet: 1, acting: true, button: true },
          { stack: 264, bet: 2 },
        ],
        clockSeat: OPP,
        last: { k: 'newhand' },
      }),
    },
    {
      delay: 1800,
      label: 'The last hand, the button raises and it is on you',
      view: view({
        h: 25, n: 2, street: 'pre', board: [], pot: 8, seedHash: HASH2,
        seats: [
          { stack: 126, bet: 6, button: true, last: { a: 'r', v: 6 } },
          { stack: 264, bet: 2, acting: true },
        ],
        legal: { actions: ['f', 'c', 'r'], call: 4, min: 10, max: 264 },
        clockSeat: YOU,
        last: { k: 'act', seat: OPP, a: 'r', v: 6 },
      }),
    },
    {
      delay: 2000,
      label: 'You call and it checks down to the river',
      view: view({
        h: 25, n: 3, street: 'showdown', board: H2_BOARD, pot: 12, seedHash: HASH2,
        seats: [
          { stack: 126, button: true, cards: H2_OPP_CARDS },
          { stack: 258, last: { a: 'x' } },
        ],
        last: { k: 'showdown', cards: H2_OPP_CARDS },
      }),
    },
    {
      /* A showdown you lose, held on screen: this is the moment the audit
         found the old table threw away. */
      delay: 3000,
      label: 'You lose the showdown, the last hand of the match',
      view: view({
        h: 25, n: 4, street: 'done', board: H2_BOARD, pot: 12, seedHash: HASH2,
        seed: SEED1,
        seats: [
          { stack: 138, button: true, cards: H2_OPP_CARDS },
          { stack: 258 },
        ],
        result: {
          awards: [{ seat: OPP, amount: 12, hand: 'three of a kind, queens' }],
          shown: { [OPP]: H2_OPP_CARDS, [YOU]: HU_HOLE },
        },
        last: { k: 'award', seat: OPP, v: 12 },
      }),
    },
    {
      delay: 0,
      label: 'Match result',
      end: {
        winner: 'u-you',
        reason: 'hands',
        stacks: { 'u-you': 258, 'u-opp': 138 },
        places: { 'u-you': 1, 'u-opp': 2 },
        rated: true,
        ratings: {
          'u-you': { before: 1518, after: 1537, rdBefore: 84, rdAfter: 81 },
          'u-opp': { before: 1642, after: 1623, rdBefore: 61, rdAfter: 60 },
        },
      },
    },
  ];
}

/* -------------------------------------------------------------- six-max */

/* The names people actually get: CamelCase, two words, up to about sixteen
   characters. The script used to use short lowercase ones, which is why the
   screenshot suite never noticed that every ring seat was truncating at six
   letters on a live table. A mock that is easier than reality tests nothing. */
const SIX: Player[] = [
  { uid: 'u-dredger', name: 'PoliteSaxophone', rating: 1602 },
  { uid: 'u-hexmark', name: 'BriskQuarry', rating: 1500, bot: true },
  { uid: 'u-you', name: 'RustyAlligator', rating: 1518 },
  { uid: 'u-ninecut', name: 'IcyPencil', rating: 1477 },
  { uid: 'u-pellmell', name: 'DeepShelf', rating: 1500, bot: true },
  /* The button sits here in both scripted hands, and on a practice table the
     player holding it is a bot as often as not: the two marks have to share
     a seat without landing on each other. */
  { uid: 'u-quarrel', name: 'VividMoonlight', rating: 1560, bot: true },
];
const ME = 2;
const SIX_HOLE: Card[] = ['Ah', 'Kd'];
const BUST_CARDS: Card[] = ['Qs', 'Qc'];
const SIX_BOARD: Card[] = ['Kc', '7s', '2d', 'Th', '5c'];
/* The hand the table ends on: everyone in, aces hold. */
const SIX_END_BOARD: Card[] = ['Ad', '8c', '3h', 'Tc', '2s'];
const SIX_END_HOLE: Card[] = ['Ah', 'Td'];

/* Hand 8 is the last of level one, so the header counts down to the change and
   hand 9 opens on the new blinds. */
function sixMaxScript(): MockStep[] {
  const format = formatFor('six-max', true);
  const blindsOf = (h: number) => format.levels[Math.min(format.levels.length - 1, Math.floor((h - 1) / format.levelHands))];
  const view = viewer(SIX, ME, SIX_HOLE, format, blindsOf);
  const board = (n: number) => SIX_BOARD.slice(0, n);

  return [
    {
      delay: 2000,
      label: 'Six handed, blinds 1 and 2, you act first',
      view: view({
        h: 8, n: 1, street: 'pre', board: [], pot: 3,
        seats: [
          { stack: 239, bet: 1 },
          { stack: 178, bet: 2 },
          { stack: 265, acting: true },
          { stack: 62 },
          { stack: 145 },
          { stack: 308, button: true },
        ],
        legal: { actions: ['f', 'c', 'r'], call: 2, min: 4, max: 265 },
        clockSeat: ME,
        last: { k: 'deal' },
      }),
    },
    {
      delay: 1600,
      label: 'You raise to 6',
      view: view({
        h: 8, n: 2, street: 'pre', board: [], pot: 9,
        seats: [
          { stack: 239, bet: 1 },
          { stack: 178, bet: 2 },
          { stack: 259, bet: 6, last: { a: 'r', v: 6 } },
          { stack: 62, acting: true },
          { stack: 145 },
          { stack: 308, button: true },
        ],
        clockSeat: 3,
        last: { k: 'act', seat: ME, a: 'r', v: 6 },
      }),
    },
    {
      delay: 2200,
      label: 'ninecut moves all in for 62, the table folds to you',
      view: view({
        h: 8, n: 6, street: 'pre', board: [], pot: 71,
        seats: [
          { stack: 239, bet: 1, folded: true, cards: null, last: { a: 'f' } },
          { stack: 178, bet: 2, folded: true, cards: null, last: { a: 'f' } },
          { stack: 259, bet: 6, acting: true },
          { stack: 0, bet: 62, allin: true, last: { a: 'a' } },
          { stack: 145, folded: true, cards: null, last: { a: 'f' } },
          { stack: 308, button: true, folded: true, cards: null, last: { a: 'f' } },
        ],
        legal: { actions: ['f', 'c'], call: 56, min: 0, max: 0 },
        clockSeat: ME,
        last: { k: 'act', seat: 3, a: 'a' },
      }),
    },
    {
      delay: 2000,
      label: 'You call and the board runs out',
      view: view({
        h: 8, n: 7, street: 'river', board: board(5), pot: 127,
        seats: [
          { stack: 239, folded: true, cards: null, last: { a: 'f' } },
          { stack: 178, folded: true, cards: null, last: { a: 'f' } },
          { stack: 203, last: { a: 'c', v: 56 } },
          { stack: 0, allin: true, cards: BUST_CARDS },
          { stack: 145, folded: true, cards: null, last: { a: 'f' } },
          { stack: 308, button: true, folded: true, cards: null, last: { a: 'f' } },
        ],
        last: { k: 'showdown', cards: BUST_CARDS },
      }),
    },
    {
      delay: 3000,
      label: 'Kings hold, ninecut is out in sixth',
      view: view({
        h: 8, n: 8, street: 'done', board: board(5), pot: 127,
        seed: SEED1,
        seats: [
          { stack: 239, folded: true, cards: null },
          { stack: 178, folded: true, cards: null },
          { stack: 330 },
          { stack: 0, out: true, place: 6, cards: BUST_CARDS },
          { stack: 145, folded: true, cards: null },
          { stack: 308, button: true, folded: true, cards: null },
        ],
        result: {
          awards: [{ seat: ME, amount: 127, hand: 'one pair, kings' }],
          shown: { [ME]: SIX_HOLE, 3: BUST_CARDS },
        },
        last: { k: 'award', seat: ME, v: 127 },
      }),
    },
    {
      delay: 2600,
      label: 'Hand nine deals on the new level, five left',
      view: view({
        h: 9, n: 1, street: 'pre', board: [], pot: 6, seedHash: HASH2,
        seats: [
          { stack: 237, bet: 2 },
          { stack: 174, bet: 4 },
          { stack: 330, acting: true },
          { stack: 0, out: true, place: 6, cards: null },
          { stack: 145 },
          { stack: 308, button: true },
        ],
        legal: { actions: ['f', 'c', 'r'], call: 4, min: 8, max: 330 },
        clockSeat: ME,
        last: { k: 'newhand' },
      }),
    },
    {
      /* Four opponents all in on one hand is the only way a sit and go ends in
         a single step, and the last hand is held on screen like any other. */
      delay: 3200,
      label: 'Everyone is in, the aces hold and the table is yours',
      view: view({
        h: 9, n: 9, street: 'done', board: SIX_END_BOARD, pot: 1200, seedHash: HASH2,
        seed: SEED1,
        seats: [
          { stack: 0, out: true, place: 3, cards: ['Jc', 'Jd'] },
          { stack: 0, out: true, place: 4, cards: ['9s', '9d'] },
          { stack: 1200, cards: SIX_END_HOLE },
          { stack: 0, out: true, place: 6, cards: null },
          { stack: 0, out: true, place: 5, cards: ['7c', '7h'] },
          { stack: 0, out: true, place: 2, button: true, cards: ['Ks', 'Qs'] },
        ],
        result: {
          awards: [{ seat: ME, amount: 1200, hand: 'two pair, aces and tens' }],
          shown: {
            0: ['Jc', 'Jd'], 1: ['9s', '9d'], [ME]: SIX_END_HOLE,
            4: ['7c', '7h'], 5: ['Ks', 'Qs'],
          },
        },
        last: { k: 'award', seat: ME, v: 1200 },
      }),
    },
    {
      delay: 0,
      label: 'Match result',
      end: {
        winner: 'u-you',
        reason: 'bust',
        stacks: {
          'u-you': 1200, 'u-quarrel': 0, 'u-dredger': 0,
          'u-pellmell': 0, 'u-hexmark': 0, 'u-ninecut': 0,
        },
        places: {
          'u-you': 1, 'u-quarrel': 2, 'u-dredger': 3,
          'u-hexmark': 4, 'u-pellmell': 5, 'u-ninecut': 6,
        },
        rated: true,
        ratings: {
          'u-you': { before: 1518, after: 1561, rdBefore: 84, rdAfter: 79 },
          'u-quarrel': { before: 1560, after: 1566, rdBefore: 62, rdAfter: 61 },
          'u-dredger': { before: 1602, after: 1598, rdBefore: 58, rdAfter: 58 },
          'u-pellmell': { before: 1500, after: 1494, rdBefore: 45, rdAfter: 45 },
          'u-hexmark': { before: 1500, after: 1489, rdBefore: 45, rdAfter: 45 },
          'u-ninecut': { before: 1477, after: 1459, rdBefore: 91, rdAfter: 87 },
        },
      },
    },
  ];
}

export const MOCK_ME = {
  id: 'u-you', name: 'you', guest: true, bot: false, rating: 1518, rd: 84, provisional: false,
};

/* A scripted conversation for the mock table, so the panel has something in it
   to look at and to measure a toggle against. Times are relative to when the
   page opened, which keeps a screenshot from depending on the clock. One line
   comes from the rail, because a spectator's line reads differently from a
   seat's and that difference is the thing worth seeing. */
export function mockChat(now: number): ChatLine[] {
  const lines: [ChatFrom, string, number][] = [
    [{ id: 'u-opp', name: 'riverrat', bot: false, seat: 0 }, 'Good luck', 240_000],
    [{ id: 'u-you', name: 'kestrel', bot: false, seat: 1 }, 'You too', 232_000],
    [{ id: 'u-quarrel', name: 'quarrel', bot: false, seat: null }, 'Nice spot on the turn', 90_000],
    [{ id: 'u-opp', name: 'riverrat', bot: false, seat: 0 }, 'Nice hand', 20_000],
  ];
  return lines.map(([from, text, ago]) => ({ id: lineId(from, now - ago), from, text, at: now - ago }));
}
