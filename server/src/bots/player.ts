import type { ClientMsg, ServerMsg, TableView } from '@opentable/protocol';
import { decide, type Rng } from './strategy.js';

/* One bot at the table. It has no socket: the hub routes its messages to
   `receive` instead, so it sees exactly the same `state` views a browser
   would, with the same hole cards masked, and it answers by pushing an `act`
   back through the ordinary client router. Nothing about the match, the
   clock or persistence knows it is not a person.

   It thinks for a random moment before acting, both so a hand is watchable
   and so its timing is not a tell. The delay is capped against the decision
   clock, which is what makes a test running a 300ms clock finish this
   decade; it never runs out of time, because the decision is already made
   when the timer is set. */

const THINK_MIN_MS = 600;
const THINK_MAX_MS = 1800;
const QUICK_MIN_MS = 100;
const QUICK_MAX_MS = 400;
const CLOCK_FRACTION = 4; // never think for longer than a quarter of the clock

export type Dispatch = (userId: string, msg: ClientMsg) => void;

export class BotPlayer {
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private pending = new Set<string>();

  constructor(
    readonly userId: string,
    private dispatch: Dispatch,
    private rng: Rng = Math.random
  ) {}

  receive(msg: ServerMsg): void {
    if (msg.t === 'q' && msg.s === 'found' && msg.m) {
      this.dispatch(this.userId, { t: 'join', m: msg.m });
      return;
    }
    if (msg.t === 'end') {
      this.clear();
      return;
    }
    if (msg.t === 'state') this.onView(msg.s);
  }

  private onView(view: TableView): void {
    if (!view.legal || view.you === null) return;
    // A view can be rebroadcast without the action moving on (an opponent
    // disconnecting, say); key on the exact decision point so the bot does
    // not queue the same action twice.
    const key = `${view.m}:${view.h}:${view.n}`;
    if (this.pending.has(key)) return;
    this.pending.add(key);

    const decision = decide(view, this.rng);
    const me = view.seats[view.you];
    const trivial = decision.a === 'x' || me.stack === 0 || me.stack <= view.legal.call;
    const [lo, hi] = trivial ? [QUICK_MIN_MS, QUICK_MAX_MS] : [THINK_MIN_MS, THINK_MAX_MS];
    const cap = Math.max(1, Math.floor(view.format.clockMs / CLOCK_FRACTION));
    const delay = Math.min(cap, lo + this.rng() * (hi - lo));

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

  clear(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.pending.clear();
  }
}
