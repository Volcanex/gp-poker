import { DEFAULT_BOT_LEVEL, type BotLevel, type ClientMsg, type ServerMsg, type TableView } from '@opentable/protocol';
import { decide, type BotDecision, type Rng } from './strategy.js';
import { decideSolver, observeSolverResult, thinkingTier } from './solver.js';
import { NEUTRAL_PERSONA, type Persona } from './persona.js';
import type { ChatProfile } from './population-roster.js';
import { spotThinkMs, thinkRange } from './pacing.js';

export { thinkRange } from './pacing.js';

/* One bot at the table. It has no socket: the hub routes its messages to
   `receive` instead, so it sees exactly the same `state` views a browser
   would, with the same hole cards masked, and it answers by pushing an `act`
   back through the ordinary client router. Nothing about the match, the
   clock or persistence knows it is not a person.

   It thinks for a moment before acting, both so a hand is watchable and so
   its timing is not a tell. `pacing.ts` owns the two questions that answer
   how long: which range applies (the format, and whether anyone at the
   table is not a bot) and, on a standard or fast table, where inside it a
   real decision lands (how big the decision reads: the street, and the
   price). Practice keeps the plain roll it always had, on purpose: see
   `pacing.ts` and `CLAUDE.md` for why. The delay is capped against the
   decision clock, which is what makes a test running a 300ms clock finish
   this decade; it never runs out of time, because the decision is already
   made when the timer is set.

   The range is chosen from the format on every decision rather than fixed at
   construction: the same BotPlayer instance plays a rated queue fill, a
   practice table and a ladder match across its lifetime, one after another,
   and a practice table alone is paced for a person to follow. `humanAtMatch`
   is asked the same way and for the same reason: whether this particular
   match has anyone at it who is not a bot loaded in this process. It has to
   be asked rather than read off the view, because the wire's own `bot` field
   on a seat is masked to false for the whole population once it is public
   (`shownAsBot`, `config.ts`) - the room is meant to read as people, which
   means a bot cannot tell a human from another bot by its own view either.
   `bots/index.ts` is the one place that knows which user ids are bots at
   all, so it is the one that answers this, injected the same way `dispatch`
   is: this module does not reach up to ask it directly.

   The thinking tiers are the ones whose decision takes real time, so every
   decision is awaited and whatever it spent comes off the pause afterwards: a
   bot that solved for a second and then waited its usual two would read as
   broken. It still cannot run out of time, because the pause is capped against
   the clock and the solve's own budget is a quarter of it. */

const CLOCK_FRACTION = 4; // never think for longer than a quarter of the clock

// A bot always accepts a ready check, and quickly: it has no reason to
// hesitate, and no reason to ever decline. Needed once bots can reach the
// ordinary queue on their own (`server/src/bots/population.ts`) rather than
// only being pulled in after a human's ready check already passed, which is
// the only way bots met one before.
const READY_ACCEPT_MIN_MS = 300;
const READY_ACCEPT_MAX_MS = 1200;

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
    private chat: ChatProfile | null = null,
    // Whether a match has anyone at it who is not a bot: see the class
    // comment above for why this has to be asked rather than read off the
    // view. Defaults to always-true so a caller that never supplies one (a
    // test constructing a `BotPlayer` directly) gets the paced-for-a-person
    // behaviour rather than silently the fast one.
    private humanAtMatch: (matchId: string) => boolean = () => true
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
    if (view.result && thinkingTier(this.level)) observeSolverResult(this.userId, view);
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
    const [lo, hi] = thinkRange(view.format, trivial, this.humanAtMatch(view.m));
    const cap = Math.max(1, Math.floor(view.format.clockMs / CLOCK_FRACTION));
    // A free decision lands anywhere in its (already short) range, and so
    // does a practice table's: practice is a new visitor's first look at
    // this site, and weighing a decision by how big it reads only pushes the
    // slower half of an already generous range up further, which is the
    // wrong direction to move a page somebody might bounce off. Everywhere
    // else a real decision is weighed by how big the spot reads,
    // `pacing.ts`'s job because it already knows the street and the price.
    const target =
      trivial || view.format.practice === true
        ? lo + this.rng() * (hi - lo)
        : spotThinkMs(view, decision, lo, hi, this.rng);
    const thought = Date.now() - started;
    const delay = Math.max(0, Math.min(cap, target) - thought);

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
    // A persona nudges the constants the instant tiers read; a thinking tier
    // has no constants to nudge, so it gets one only for the streets it hands
    // back.
    if (!thinkingTier(this.level)) return decide(view, this.rng, this.level, this.persona);
    const solved = await decideSolver(this.userId, view, this.rng, this.level);
    return solved ?? decide(view, this.rng, this.level, this.persona);
  }

  clear(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.pending.clear();
  }
}
