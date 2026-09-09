import { DEFAULT_BOT_LEVEL, type BotLevel, type ClientMsg, type MatchFormat, type ServerMsg, type TableView } from '@opentable/protocol';
import { decide, type BotDecision, type Rng } from './strategy.js';
import { SOLVER_LEVEL, decideSolver, observeSolverResult } from './solver.js';
import { NEUTRAL_PERSONA, type Persona } from './persona.js';
import type { ChatProfile } from './population-roster.js';

/* One bot at the table. It has no socket: the hub routes its messages to
   `receive` instead, so it sees exactly the same `state` views a browser
   would, with the same hole cards masked, and it answers by pushing an `act`
   back through the ordinary client router. Nothing about the match, the
   clock or persistence knows it is not a person.

   It thinks for a random moment before acting, both so a hand is watchable
   and so its timing is not a tell. The delay is capped against the decision
   clock, which is what makes a test running a 300ms clock finish this
   decade; it never runs out of time, because the decision is already made
   when the timer is set.

   The ranges are chosen from the format on every decision rather than fixed
   at construction: the same BotPlayer instance plays a rated queue fill, a
   practice table and a ladder match across its lifetime, one after another,
   and a practice table alone is paced for a person to follow.

   Level 6 is the one level whose decision takes real time, so the decision is
   awaited and whatever it spent comes off the pause afterwards: a bot that
   solved for a second and then waited its usual two would read as broken. It
   still cannot run out of time, because the pause is capped against the clock
   and the solve's own budget is a quarter of it. */

const THINK_MIN_MS = 600;
const THINK_MAX_MS = 1800;
const QUICK_MIN_MS = 100;
const QUICK_MAX_MS = 400;

// A practice table is a person against bots, so bots there think longer than
// they need to: fast enough not to be dull, slow enough that a hand reads as
// something happening rather than a wall of text. The quick range (a check,
// a call that costs nothing) is roughly doubled rather than left alone, for
// the same reason. Rated and casual tables against bots (the ladder, a
// filled heads-up seat) are tuned for throughput and keep the ranges above.
const PRACTICE_THINK_MIN_MS = 1400;
const PRACTICE_THINK_MAX_MS = 3200;
const PRACTICE_QUICK_MIN_MS = 200;
const PRACTICE_QUICK_MAX_MS = 800;

const CLOCK_FRACTION = 4; // never think for longer than a quarter of the clock

// A bot always accepts a ready check, and quickly: it has no reason to
// hesitate, and no reason to ever decline. Needed once bots can reach the
// ordinary queue on their own (`server/src/bots/population.ts`) rather than
// only being pulled in after a human's ready check already passed, which is
// the only way bots met one before.
const READY_ACCEPT_MIN_MS = 300;
const READY_ACCEPT_MAX_MS = 1200;

// Exported for the test suite: proving the ranges actually differ by format
// does not need a live match, timers and a socket around it.
export function thinkRange(format: MatchFormat, trivial: boolean): [number, number] {
  const practice = format.practice === true;
  if (trivial) return practice ? [PRACTICE_QUICK_MIN_MS, PRACTICE_QUICK_MAX_MS] : [QUICK_MIN_MS, QUICK_MAX_MS];
  return practice ? [PRACTICE_THINK_MIN_MS, PRACTICE_THINK_MAX_MS] : [THINK_MIN_MS, THINK_MAX_MS];
}

export type Dispatch = (userId: string, msg: ClientMsg) => void;

// Greeting and gg delays: long enough to read as somebody glancing at the
// table before typing rather than a script firing the instant a seat opens,
// short enough that the line still lands while whoever it is for is there
// to see it.
const GREET_MIN_MS = 900;
const GREET_MAX_MS = 3000;
const FAREWELL_MIN_MS = 300;
const FAREWELL_MAX_MS = 1500;

export class BotPlayer {
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private pending = new Set<string>();

  constructor(
    readonly userId: string,
    private dispatch: Dispatch,
    readonly level: BotLevel = DEFAULT_BOT_LEVEL,
    private rng: Rng = Math.random,
    readonly persona: Persona = NEUTRAL_PERSONA,
    private chat: ChatProfile | null = null
  ) {}

  receive(msg: ServerMsg): void {
    if (msg.t === 'ready' && msg.s === 'pending') {
      const delay = READY_ACCEPT_MIN_MS + this.rng() * (READY_ACCEPT_MAX_MS - READY_ACCEPT_MIN_MS);
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        this.dispatch(this.userId, { t: 'ready', a: true });
      }, delay);
      this.timers.add(timer);
      return;
    }
    if (msg.t === 'q' && msg.s === 'found' && msg.m) {
      this.dispatch(this.userId, { t: 'join', m: msg.m });
      this.maybeSpeak(msg.m, this.chat?.greeting, GREET_MIN_MS, GREET_MAX_MS, true);
      return;
    }
    if (msg.t === 'end') {
      // Sent without the decision-timer tracking below: the match is over
      // and `clear()` runs right after this, which would otherwise cancel a
      // farewell before it ever fired.
      this.maybeSpeak(msg.m, this.chat?.farewell, FAREWELL_MIN_MS, FAREWELL_MAX_MS, false);
      this.clear();
      return;
    }
    if (msg.t === 'state') this.onView(msg.s);
  }

  // A line said sparingly: `chat.chattiness` is the chance this bot says
  // anything at all in a given match, rolled once per line rather than once
  // per match, so a chatty bot that has nothing configured for one of the
  // two moments still says nothing there. `tracked` decides whether the
  // timer is cancelled by `clear()` (a greeting, which a disconnect or an
  // early finish should cancel) or left to fire on its own (a farewell,
  // dispatched from inside the handler that is about to call `clear()`).
  private maybeSpeak(matchId: string, line: string | undefined | null, minMs: number, maxMs: number, tracked: boolean): void {
    if (!line || !this.chat) return;
    if (this.rng() >= this.chat.chattiness) return;
    const delay = minMs + this.rng() * (maxMs - minMs);
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.dispatch(this.userId, { t: 'chat', m: matchId, text: line });
    }, delay);
    if (tracked) this.timers.add(timer);
  }

  private onView(view: TableView): void {
    // A finished hand carries no legal actions and is not a decision, but it
    // is the only place a level 6 bot can see that somebody folded to it.
    if (view.result && this.level === SOLVER_LEVEL) observeSolverResult(this.userId, view);
    if (!view.legal || view.you === null) return;
    // A view can be rebroadcast without the action moving on (an opponent
    // disconnecting, say); key on the exact decision point so the bot does
    // not queue the same action twice.
    const key = `${view.m}:${view.h}:${view.n}`;
    if (this.pending.has(key)) return;
    this.pending.add(key);
    void this.think(view, key);
  }

  private async think(view: TableView, key: string): Promise<void> {
    if (!view.legal || view.you === null) return;
    const started = Date.now();
    const decision = await this.choose(view);
    // The match can end while a level 6 solve is still running. `clear` empties
    // the pending set, so a decision whose key has gone is a decision nobody is
    // waiting for any more.
    if (!this.pending.has(key)) return;
    const me = view.seats[view.you];
    const trivial = decision.a === 'x' || me.stack === 0 || me.stack <= view.legal.call;
    const [lo, hi] = thinkRange(view.format, trivial);
    const cap = Math.max(1, Math.floor(view.format.clockMs / CLOCK_FRACTION));
    const thought = Date.now() - started;
    const delay = Math.max(0, Math.min(cap, lo + this.rng() * (hi - lo)) - thought);

    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.pending.delete(key);
      this.dispatch(this.userId, {
        t: 'act',
        m: view.m,
        h: view.h,
        n: view.n,
        a: decision.a,
        ...(decision.v !== undefined ? { v: decision.v } : {}),
      });
    }, delay);
    this.timers.add(timer);
  }

  private async choose(view: TableView): Promise<BotDecision> {
    if (this.level !== SOLVER_LEVEL) return decide(view, this.rng, this.level, this.persona);
    const solved = await decideSolver(this.userId, view, this.rng);
    // A persona nudges the constants the older levels read; the solver has no
    // constants to nudge, so it gets one only when it hands a spot back.
    return solved ?? decide(view, this.rng, SOLVER_LEVEL, this.persona);
  }

  clear(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.pending.clear();
  }
}
