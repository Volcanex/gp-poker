/* A thinking tier against Slumbot, over its public HTTP API. A yardstick, never a
   dependency: nothing in the product talks to it, and this script is expected
   to stop working the day they change the protocol.

   Slumbot is a heads-up no-limit hold'em research bot, two hundred big blinds
   deep at 50/100 with twenty thousand chip stacks. It is a full game solve
   rather than a street at a time, so the honest expectation is that these
   tiers lose to it; the number is worth having because it says by how much, in
   the same units everything else here is measured in.

     npx tsx server/scripts/bench-slumbot.ts
     SLUMBOT_HANDS=200 SLUMBOT_BUDGET_MS=800 npx tsx server/scripts/bench-slumbot.ts

   Protocol, as measured rather than as documented. POST /api/new_hand starts a
   hand, and passing the previous token keeps the session, which is what makes
   the seats alternate: `client_pos` 1 means we are the button and act first,
   0 means we are the big blind and their action is already in the string. POST
   /api/act with `incr` sends one action. An action string is streets separated
   by '/', each a run of 'f' (fold), 'k' (check), 'c' (call) and 'b<n>', where
   n is that player's total contribution **on that street**, which is exactly
   what this codebase calls a raise-to. A response carrying `winnings` is a
   finished hand, in chips, from our side. */

import { formatFor, type ActionKind, type BotLevel, type Card, type SeatView, type TableView } from '@opentable/protocol';
import { SolverBot, runInline } from '@opentable/solver';
import { decide, type Rng } from '../src/bots/strategy.js';
import { mulberry32 } from '../src/bots/simulate.js';
import { thinkingTier } from '../src/bots/solver.js';

const HANDS = Number(process.env.SLUMBOT_HANDS ?? 200);
const BUDGET_MS = Number(process.env.SLUMBOT_BUDGET_MS ?? 600);
const HOST = process.env.SLUMBOT_HOST ?? 'https://slumbot.com';
// Which tier to send. Slumbot is two hundred big blinds deep, which is where
// the solver tier's depth limited leaf is under the most strain, so it is the
// interesting one by default.
const LEVEL = (Number(process.env.SLUMBOT_LEVEL ?? 7) || 7) as BotLevel;
const TIER = thinkingTier(LEVEL) ?? 'solver';

const STACK = 20_000;
const SB = 50;
const BB = 100;
const FORMAT = formatFor('heads-up', false);

interface SlumbotReply {
  old_action?: string;
  action: string;
  client_pos: number;
  hole_cards: string[];
  board: string[];
  token?: string;
  winnings?: number;
  baseline_winnings?: number;
  error_msg?: string;
}

async function post(path: string, body: unknown): Promise<SlumbotReply> {
  const res = await fetch(`${HOST}/api/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  return (await res.json()) as SlumbotReply;
}

/* Seat 0 is the button and small blind, seat 1 the big blind, which is the
   order the action string is in. */
interface Position {
  street: number;
  prior: [number, number]; // contributed on earlier streets
  bets: [number, number]; // contributed on this street
  toAct: 0 | 1;
  minRaise: number;
  last: [{ a: ActionKind; v?: number } | null, { a: ActionKind; v?: number } | null];
  count: number;
  done: boolean;
}

export function parseAction(action: string): Position {
  const state: Position = {
    street: 0,
    prior: [0, 0],
    bets: [SB, BB],
    toAct: 0,
    minRaise: BB,
    last: [null, null],
    count: 0,
    done: false,
  };

  const streets = action.split('/');
  for (let s = 0; s < streets.length; s++) {
    if (s > 0) {
      state.prior = [state.prior[0] + state.bets[0], state.prior[1] + state.bets[1]];
      state.bets = [0, 0];
      state.street = s;
      state.minRaise = BB;
      state.toAct = 1; // out of position acts first once there is a board
    }
    let seat: 0 | 1 = state.toAct;
    for (const token of tokensOf(streets[s])) {
      state.count += 1;
      if (token === 'f') {
        state.last[seat] = { a: 'f' };
        state.done = true;
        return state;
      }
      if (token === 'k') {
        state.last[seat] = { a: 'x' };
      } else if (token === 'c') {
        state.bets[seat] = state.bets[1 - seat];
        state.last[seat] = { a: 'c' };
      } else {
        const to = Number(token.slice(1));
        const increase = to - state.bets[1 - seat];
        if (increase >= state.minRaise) state.minRaise = increase;
        state.bets[seat] = to;
        state.last[seat] = { a: state.prior[seat] + to >= STACK ? 'a' : 'b', v: to };
      }
      seat = (1 - seat) as 0 | 1;
    }
    state.toAct = seat;
  }
  return state;
}

function tokensOf(street: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < street.length; ) {
    const c = street[i];
    if (c === 'b') {
      let j = i + 1;
      while (j < street.length && street[j] >= '0' && street[j] <= '9') j += 1;
      out.push(street.slice(i, j));
      i = j;
    } else {
      out.push(c);
      i += 1;
    }
  }
  return out;
}

const STREETS = ['pre', 'flop', 'turn', 'river'] as const;

function viewFor(reply: SlumbotReply, position: Position, hand: number): TableView {
  // Slumbot's seat 0 is the button; client_pos 1 means we are it.
  const me = reply.client_pos === 1 ? 0 : 1;
  const cap = Math.min(STACK - position.prior[0], STACK - position.prior[1]);
  const call = Math.max(0, position.bets[1 - position.toAct] - position.bets[position.toAct]);
  const currentBet = Math.max(position.bets[0], position.bets[1]);

  const actions: ActionKind[] = ['f'];
  actions.push(call <= 0 ? 'x' : 'c');
  if (currentBet === 0) actions.push('b');
  else if (cap > currentBet) actions.push('r');
  // Only when there is something left to shove. Slumbot rejects a bet that is
  // not a raise, where the engine here would have called it an all-in.
  if (cap > currentBet) actions.push('a');

  const seats: SeatView[] = [0, 1].map((i) => ({
    i,
    uid: i === me ? 'us' : 'slumbot',
    name: i === me ? 'us' : 'slumbot',
    rating: 1500,
    stack: STACK - position.prior[i] - position.bets[i],
    bet: position.bets[i],
    cards:
      i === me
        ? (reply.hole_cards.map(normalise) as Card[])
        : (['?', '?'] as Card[]),
    folded: false,
    allin: false,
    button: i === 0,
    acting: i === position.toAct,
    connected: true,
    bot: true,
    out: false,
    place: null,
    last: position.last[i],
  }));

  return {
    m: 'slumbot',
    h: hand,
    n: position.count,
    street: STREETS[position.street],
    board: reply.board.map(normalise) as Card[],
    pot: position.prior[0] + position.prior[1] + position.bets[0] + position.bets[1],
    pots: [],
    seats,
    you: me,
    legal: {
      actions,
      call,
      min: currentBet === 0 ? Math.min(BB, cap) : Math.min(currentBet + position.minRaise, cap),
      max: cap,
    },
    clock: null,
    seedHash: '',
    seed: null,
    format: FORMAT,
    blinds: { sb: SB, bb: BB },
    handsPlayed: hand - 1,
    last: null,
    result: null,
  };
}

// Slumbot writes ranks upper case and suits lower case already, but a ten can
// arrive either way depending on the endpoint.
function normalise(card: string): string {
  return `${card[0].toUpperCase()}${card[1].toLowerCase()}`;
}

/* Slumbot validates strictly, so anything that is not clearly a raise goes out
   as a call or a check instead. A rejected action costs the whole hand. */
function encode(decision: { a: ActionKind; v?: number }, view: TableView, position: Position): string {
  const legal = view.legal!;
  if (decision.a === 'f') return legal.call > 0 ? 'f' : 'k';
  if (decision.a === 'x') return legal.call > 0 ? 'c' : 'k';
  if (decision.a === 'c') return legal.call > 0 ? 'c' : 'k';
  const currentBet = Math.max(position.bets[0], position.bets[1]);
  const wanted = decision.a === 'a' ? legal.max : (decision.v ?? legal.min);
  const to = Math.max(legal.min, Math.min(legal.max, Math.round(wanted)));
  if (!(to > currentBet)) return legal.call > 0 ? 'c' : 'k';
  return `b${to}`;
}

async function main(): Promise<void> {
  const bot = new SolverBot({ tier: TIER, fallback: (view, rng) => decide(view, rng, LEVEL) });
  const rng: Rng = mulberry32(20260909);
  let token: string | undefined;
  const results: number[] = [];
  const baselines: number[] = [];
  let errors = 0;

  for (let hand = 1; hand <= HANDS; hand++) {
    let reply = await post('new_hand', token ? { token } : {});
    if (reply.error_msg) {
      errors += 1;
      continue;
    }
    token = reply.token ?? token;

    let guard = 0;
    while (reply.winnings === undefined && !reply.error_msg && guard++ < 60) {
      const position = parseAction(reply.action);
      const parsedFrom = reply.action;
      if (position.done) break;
      const view = viewFor(reply, position, hand);
      const decision = await bot.decide(view, rng, runInline, BUDGET_MS);
      const incr = encode(decision, view, position);
      reply = await post('act', { token, incr });
      if (reply.error_msg) console.error(`  hand ${hand}: ${reply.error_msg} sending ${incr} after ${JSON.stringify(view.legal)} on "${parsedFrom}"`);
    }

    if (reply.error_msg) {
      errors += 1;
      console.error(`hand ${hand}: ${reply.error_msg}`);
      continue;
    }
    if (reply.winnings === undefined) {
      errors += 1;
      continue;
    }
    // A hand that ended on a fold showed nobody a hand, which is the one thing
    // the range tracker cannot see for itself.
    bot.observeResult({
      m: 'slumbot',
      h: hand,
      result: { awards: [], shown: reply.action.endsWith('f') ? {} : { 0: [], 1: [] } },
    } as never);
    results.push(reply.winnings);
    if (reply.baseline_winnings !== undefined) baselines.push(reply.baseline_winnings);

    if (hand % 25 === 0) console.log(`  ${hand} hands, ${bb100(results).toFixed(0)} bb/100 so far`);
  }

  const n = results.length;
  console.log(`\n${n} hands against Slumbot, ${BUDGET_MS}ms budget, ${errors} hands dropped`);
  console.log(`bb/100 ${bb100(results).toFixed(1)} +/- ${se(results).toFixed(1)}`);
  if (baselines.length === n && n > 0) {
    const reduced = results.map((v, i) => v - baselines[i]);
    console.log(`bb/100 with Slumbot's own variance reduction ${bb100(reduced).toFixed(1)} +/- ${se(reduced).toFixed(1)}`);
  }
}

function bb100(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return (100 * mean) / BB;
}

function se(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  return (100 * Math.sqrt(variance / n)) / BB;
}

await main();
