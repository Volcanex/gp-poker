/* Dev-only. A scripted TableView sequence pushed through the real renderer, so
   the table can be looked at without a server. Reached at /m/mock (or any match
   URL with ?mock=1); ?step=N freezes on one moment for a screenshot. Nothing
   here is imported by the production paths other than the match route's branch
   on that id. */
import { DEFAULT_FORMAT } from '@opentable/protocol';
import type { ActionKind, Card, LastEvent, MatchResult, SeatView, TableView } from '@opentable/protocol';

const OPP = 0;
const YOU = 1;
const HASH1 = 'b1f3c9a7d2e480516c4a9f0b3d7e2851aa64c3f9207d5e8b1c6f4a09d3e75b2c8';
const SEED1 = '9d4e1b7a3f02c85641d9a0e73b2c5f8e0a6d31c94b7f28e50a3d6c19f4b8e2705';
const HASH2 = '7c2a5e91d3b64f08a1c9e7d250b3f846ac1d9e05b7f3a2680c4d1e9b6a5f3072';

const board: Card[] = ['7h', '2c', 'Jh', 'Td', '4h'];
const yourCards: Card[] = ['Kh', '9h'];
const oppCards: Card[] = ['As', 'Qd'];
const HIDDEN: Card[] = ['?', '?'];

interface SeatSpec {
  stack: number;
  bet: number;
  acting?: boolean;
  folded?: boolean;
  allin?: boolean;
  last?: { a: ActionKind; v?: number } | null;
  cards?: Card[] | null;
  connected?: boolean;
}

function seat(i: number, spec: SeatSpec): SeatView {
  const you = i === YOU;
  return {
    i,
    uid: you ? 'u-you' : 'u-opp',
    name: you ? 'kestrel' : 'riverrat',
    rating: you ? 1518 : 1642,
    stack: spec.stack,
    bet: spec.bet,
    cards: spec.cards === undefined ? (you ? yourCards : HIDDEN) : spec.cards,
    folded: spec.folded ?? false,
    allin: spec.allin ?? false,
    button: i === YOU,
    acting: spec.acting ?? false,
    connected: spec.connected ?? true,
    last: spec.last ?? null,
  };
}

interface ViewSpec {
  h?: number;
  n: number;
  street: TableView['street'];
  cards: number; // board cards shown
  pot: number;
  opp: SeatSpec;
  you: SeatSpec;
  legal?: TableView['legal'];
  clockSeat?: number;
  last?: LastEvent | null;
  result?: TableView['result'];
  seed?: string | null;
  seedHash?: string;
}

function view(spec: ViewSpec): TableView {
  const clockSeat = spec.clockSeat;
  return {
    m: 'mock',
    h: spec.h ?? 1,
    n: spec.n,
    street: spec.street,
    board: board.slice(0, spec.cards),
    pot: spec.pot,
    pots: [],
    seats: [seat(OPP, spec.opp), seat(YOU, spec.you)],
    you: YOU,
    legal: spec.legal ?? null,
    clock:
      clockSeat == null
        ? null
        : { seat: clockSeat, deadline: Date.now() + DEFAULT_FORMAT.clockMs, paused: false },
    seedHash: spec.seedHash ?? HASH1,
    seed: spec.seed ?? null,
    format: DEFAULT_FORMAT,
    handsPlayed: (spec.h ?? 1) - 1,
    last: spec.last ?? null,
    result: spec.result ?? null,
  };
}

export interface MockStep {
  delay: number; // ms to hold before the next step
  label: string;
  view?: TableView;
  end?: MatchResult;
}

export function mockScript(): MockStep[] {
  return [
    {
      delay: 1600,
      label: 'Blinds posted, you act first preflop',
      view: view({
        n: 1, street: 'pre', cards: 0, pot: 3,
        opp: { stack: 198, bet: 2 },
        you: { stack: 199, bet: 1, acting: true },
        legal: { actions: ['f', 'c', 'r'], call: 1, min: 4, max: 200 },
        clockSeat: YOU,
        last: { k: 'deal' },
      }),
    },
    {
      delay: 1400,
      label: 'You raise to 6',
      view: view({
        n: 2, street: 'pre', cards: 0, pot: 8,
        opp: { stack: 198, bet: 2, acting: true },
        you: { stack: 194, bet: 6, last: { a: 'r', v: 6 } },
        clockSeat: OPP,
        last: { k: 'act', seat: YOU, a: 'r', v: 6 },
      }),
    },
    {
      delay: 1200,
      label: 'Opponent calls',
      view: view({
        n: 3, street: 'pre', cards: 0, pot: 12,
        opp: { stack: 194, bet: 6, last: { a: 'c', v: 4 } },
        you: { stack: 194, bet: 6, last: { a: 'r', v: 6 } },
        last: { k: 'act', seat: OPP, a: 'c', v: 4 },
      }),
    },
    {
      delay: 1800,
      label: 'Flop, chips are in the pot',
      view: view({
        n: 4, street: 'flop', cards: 3, pot: 12,
        opp: { stack: 194, bet: 0, acting: true },
        you: { stack: 194, bet: 0 },
        clockSeat: OPP,
        last: { k: 'street' },
      }),
    },
    {
      delay: 1400,
      label: 'Opponent checks, the bar is yours',
      view: view({
        n: 5, street: 'flop', cards: 3, pot: 12,
        opp: { stack: 194, bet: 0, last: { a: 'x' } },
        you: { stack: 194, bet: 0, acting: true },
        legal: { actions: ['x', 'b'], call: 0, min: 2, max: 194 },
        clockSeat: YOU,
        last: { k: 'act', seat: OPP, a: 'x' },
      }),
    },
    {
      delay: 1300,
      label: 'You bet 8',
      view: view({
        n: 6, street: 'flop', cards: 3, pot: 20,
        opp: { stack: 194, bet: 0, acting: true },
        you: { stack: 186, bet: 8, last: { a: 'b', v: 8 } },
        clockSeat: OPP,
        last: { k: 'act', seat: YOU, a: 'b', v: 8 },
      }),
    },
    {
      delay: 1500,
      label: 'Opponent calls the flop bet',
      view: view({
        n: 7, street: 'flop', cards: 3, pot: 28,
        opp: { stack: 186, bet: 8, last: { a: 'c', v: 8 } },
        you: { stack: 186, bet: 8, last: { a: 'b', v: 8 } },
        last: { k: 'act', seat: OPP, a: 'c', v: 8 },
      }),
    },
    {
      delay: 1600,
      label: 'Turn',
      view: view({
        n: 8, street: 'turn', cards: 4, pot: 28,
        opp: { stack: 186, bet: 0, last: { a: 'x' } },
        you: { stack: 186, bet: 0, acting: true },
        legal: { actions: ['x', 'b'], call: 0, min: 2, max: 186 },
        clockSeat: YOU,
        last: { k: 'street' },
      }),
    },
    {
      delay: 1300,
      label: 'You bet 18 on the turn',
      view: view({
        n: 9, street: 'turn', cards: 4, pot: 46,
        opp: { stack: 186, bet: 0, acting: true },
        you: { stack: 168, bet: 18, last: { a: 'b', v: 18 } },
        clockSeat: OPP,
        last: { k: 'act', seat: YOU, a: 'b', v: 18 },
      }),
    },
    {
      delay: 2000,
      label: 'Opponent raises to 52, you are facing a decision',
      view: view({
        n: 10, street: 'turn', cards: 4, pot: 98,
        opp: { stack: 134, bet: 52, last: { a: 'r', v: 52 } },
        you: { stack: 168, bet: 18, acting: true },
        legal: { actions: ['f', 'c', 'r'], call: 34, min: 86, max: 186 },
        clockSeat: YOU,
        last: { k: 'act', seat: OPP, a: 'r', v: 52 },
      }),
    },
    {
      delay: 1600,
      label: 'You call',
      view: view({
        n: 11, street: 'turn', cards: 4, pot: 132,
        opp: { stack: 134, bet: 52, last: { a: 'r', v: 52 } },
        you: { stack: 134, bet: 52, last: { a: 'c', v: 34 } },
        last: { k: 'act', seat: YOU, a: 'c', v: 34 },
      }),
    },
    {
      delay: 1600,
      label: 'River, opponent checks',
      view: view({
        n: 12, street: 'river', cards: 5, pot: 132,
        opp: { stack: 134, bet: 0, last: { a: 'x' } },
        you: { stack: 134, bet: 0, acting: true },
        legal: { actions: ['x', 'b'], call: 0, min: 2, max: 134 },
        clockSeat: YOU,
        last: { k: 'street' },
      }),
    },
    {
      delay: 1400,
      label: 'You check behind',
      view: view({
        n: 13, street: 'showdown', cards: 5, pot: 132,
        opp: { stack: 134, bet: 0, cards: oppCards },
        you: { stack: 134, bet: 0, last: { a: 'x' } },
        last: { k: 'showdown', cards: oppCards },
      }),
    },
    {
      delay: 2600,
      label: 'Showdown, the pot is awarded',
      view: view({
        n: 14, street: 'done', cards: 5, pot: 132,
        opp: { stack: 134, bet: 0, cards: oppCards },
        you: { stack: 266, bet: 0 },
        seed: SEED1,
        result: {
          awards: [{ seat: YOU, amount: 132, hand: 'flush, king high' }],
          shown: { [OPP]: oppCards, [YOU]: yourCards },
        },
        last: { k: 'award', seat: YOU, v: 132 },
      }),
    },
    {
      delay: 2400,
      label: 'Hand two deals',
      view: view({
        h: 2, n: 1, street: 'pre', cards: 0, pot: 3, seedHash: HASH2,
        opp: { stack: 132, bet: 1, acting: true },
        you: { stack: 264, bet: 2 },
        clockSeat: OPP,
        last: { k: 'newhand' },
      }),
    },
    {
      delay: 0,
      label: 'Match result',
      end: {
        winner: 'u-you',
        reason: 'hands',
        stacks: { 'u-you': 266, 'u-opp': 134 },
        rated: true,
        ratings: {
          'u-you': { before: 1518, after: 1537, rdBefore: 84, rdAfter: 81 },
          'u-opp': { before: 1642, after: 1623, rdBefore: 61, rdAfter: 60 },
        },
      },
    },
  ];
}

export const MOCK_ME = { id: 'u-you', name: 'you', guest: true, rating: 1518, rd: 84, provisional: false };
