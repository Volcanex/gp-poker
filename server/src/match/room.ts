import { shownAsBot } from '../config.js';
import type { ChatFrom, ClientMsg, MatchResult, ServerMsg } from '@opentable/protocol';
import { CHAT_HISTORY, EXTRA_TIME_MS, EXTRA_TIME_USES } from '@opentable/protocol';
import { hub } from '../ws/hub.js';
import { ChatLimiter, chatRejectionText, cleanChatText } from '../chat.js';
import {
  finishMatch as persistFinishMatch,
  getRatingsForUsers,
  getUserById,
  insertChatMessage,
  type MatchRow,
} from '../db.js';
import { practiceAwayFor } from '@opentable/protocol';
import { chargeWalkout } from '../walkouts.js';
import { trackSpectator, unregisterRoom, untrackSpectator } from './rooms.js';
import { emitMatchFinished } from './finished.js';
import { EngineHandRunner } from './handRunner.js';
import { computeMatchRatings } from './rating.js';
import { roundRatings } from '../userView.js';
import type { HandRunner, MatchOutcome, RoomClock, SeatPresence } from './types.js';

export type { HandRunner, MatchOutcome, RoomClock, SeatPresence } from './types.js';

// How long a finished match's room stays addressable after it ends, so a
// `join` that arrives moments after `end` (or a client that was mid-reconnect)
// still gets the final state instead of `no_match`.
const ROOM_LINGER_MS = 60_000;

// Consecutive timeouts before a player stops being treated as present.
const TIMEOUT_STREAK_LIMIT = 3;

// Full Glicko-2 precision, no volatility (that never goes on the wire).
// `matches.ratings` is persisted with this, full precision, the `end`
// message sends `roundRatings()` of it instead.
type ChatLine = Extract<ServerMsg, { t: 'chat' }>;

function toMatchResultRatings(outcome: MatchOutcome): MatchResult['ratings'] {
  const ratings: MatchResult['ratings'] = {};
  for (const [uid, r] of Object.entries(outcome.ratings)) {
    ratings[uid] = { before: r.before, after: r.after, rdBefore: r.rdBefore, rdAfter: r.rdAfter };
  }
  return ratings;
}

export class MatchRoom {
  readonly id: string;
  readonly playerIds: string[]; // seat order

  private match: MatchRow;
  private subscribers = new Set<string>();
  // Subscribers who have no seat. A subset of `subscribers`, kept apart only
  // so the room can say how many people are watching and so a disconnect
  // knows which subscriptions to drop: a player's stays through their grace
  // window, a spectator's does not.
  private spectators = new Set<string>();
  private disconnected = new Set<string>();
  private graceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private timeoutStreak = new Map<string, number>();
  /* Multiway only, and never on a practice table: a player who timed out
     three times running is sat out. They are still dealt in and still post
     blinds, and their decision is check-folded on arrival while they are
     away. It goes on the wire (`SeatView.sittingOut`) so the table can see
     it and its own player can answer it with `back`. Heads-up forfeits
     instead, as it always has. */
  private satOut = new Set<string>();
  // Left on purpose. A superset of `satOut` in effect but not in kind: a
  // sat-out player is one who stopped answering and is welcome back the
  // moment they act, and this is one who said they were done, so nothing
  // un-sits them and no action of theirs is accepted again.
  private resigned = new Set<string>();
  /* Where a multiway leaver finishes, fixed at the moment they leave: last
     among the seats still in at the time. The chips do not care that
     somebody has gone, so blinding them off leaves them able to outlast the
     two seats that busted each other, which would hand the match to the
     person who walked out of it. See `applyLeftPlaces`. */
  private leftPlaces = new Map<string, number>();
  /* How much of their extra time each player has spent, counted against
     `EXTRA_TIME_USES` rather than held as a boolean, so the allowance is the
     protocol's number and not this file's assumption about it. Never cleared
     for the life of the match: a new hand is not a new two minutes. It goes
     on the wire per seat as `SeatView.extraUsed`, which is the exhausted
     state and is what greys the control out. */
  private extraSpent = new Map<string, number>();
  private clockTimer: ReturnType<typeof setTimeout> | null = null;
  private clock: RoomClock | null = null;
  private lastResult: MatchResult | null = null;
  // Chat, two channels and one allowance. The players' channel goes to
  // everybody; the rail's goes only to the rail, so a table cannot be coached
  // from it. They are capped separately rather than as one list of a hundred:
  // a busy rail would otherwise evict the conversation a reconnecting player
  // came back for.
  private chatLimiter = new ChatLimiter();
  private playerChat: ChatLine[] = [];
  private railChat: ChatLine[] = [];

  private hand: HandRunner | null = null;
  /* Set the moment a finish starts, not when it lands. `finishMatch` awaits
     a database write before `match.status` says finished, and freeing the
     hand runner's hold hands control back to it inside that window: it then
     settles the hand it was holding and reports a second, natural ending
     over the top of the one being written. A match ends once. */
  private finishing = false;

  // The format is the only source of truth for whether this match is rated.
  // `matches.rated` is a copy of it, re-asserted on finish; nothing reads the
  // column to make a decision.
  private get rated(): boolean {
    return this.match.format.rated;
  }

  /* One person against bots. Nobody at a practice table is being kept
     waiting by a player who has gone quiet, so nothing there counts a
     timeout streak into a sit-out or a forfeit and a disconnect pauses the
     clock for as long as it lasts rather than for `graceMs`. */
  private get practice(): boolean {
    return this.match.format.practice === true;
  }

  constructor(match: MatchRow) {
    this.id = match.id;
    this.match = match;
    this.playerIds = [...match.seats].sort((a, b) => a.seat - b.seat).map((s) => s.userId);
    for (const uid of this.playerIds) this.timeoutStreak.set(uid, 0);
  }

  // Builds the hand runner and deals hand 1. Callers (matchmaking) should
  // await this before telling clients the match was `found`, so a join right
  // after that message always has a hand to view.
  async start(): Promise<void> {
    this.hand = new EngineHandRunner({
      matchId: this.id,
      match: this.match,
      onChange: () => {
        // Rearm first, always: `clock` is read by `viewFor`, so a broadcast
        // sent before it is rearmed reports the clock of the seat that has
        // just acted. See "Clock design" in CLAUDE.md.
        this.rearmClock();
        this.broadcast();
        this.settleIfDone();
      },
      onFail: (err) => this.abandon(err),
    });
    await this.hand.startHand(1);
    this.rearmClock();
    this.broadcast();
  }

  // Whether the match is still live. Matchmaking asks this before putting a
  // bot into a new table, since a finished room lingers for a minute.
  get active(): boolean {
    return this.match.status === 'playing';
  }

  // Anyone may join. A player joins their own table; anybody else becomes a
  // spectator and is sent exactly the view an opponent gets, with no seat and
  // every hole card hidden until showdown. A finished room lingers a minute,
  // and a join inside that window still gets the final view and the result,
  // so a link followed moments too late reads rather than erroring.
  join(userId: string): void {
    this.subscribers.add(userId);
    if (!this.playerIds.includes(userId) && !this.spectators.has(userId)) {
      this.spectators.add(userId);
      trackSpectator(userId, this);
    }
    this.sendViewTo(userId);
    this.replayChatTo(userId);
    if (this.match.status === 'finished' && this.lastResult) {
      hub.send(userId, { t: 'end', m: this.id, r: this.lastResult });
    }
  }

  leave(userId: string): void {
    this.subscribers.delete(userId);
    if (this.spectators.delete(userId)) untrackSpectator(userId, this);
  }

  // How many people are watching without a seat. Reported on /api/live and
  // deliberately never sent to the table: a count that moves while somebody
  // is deciding is a distraction, not information.
  get spectatorCount(): number {
    return this.spectators.size;
  }

  get spectatorIds(): string[] {
    return [...this.spectators];
  }

  private presence(): SeatPresence[] {
    return this.playerIds.map((id) => ({
      connected: !this.disconnected.has(id),
      sittingOut: this.satOut.has(id),
      extraUsed: this.extraLeft(id) <= 0,
    }));
  }

  private sendViewTo(userId: string): void {
    if (!this.hand) return;
    const view = this.hand.viewFor(userId, this.clock, this.presence());
    if (view) hub.send(userId, { t: 'state', s: view });
  }

  broadcast(): void {
    if (!this.hand) return;
    for (const uid of this.subscribers) this.sendViewTo(uid);
  }

  /* ------------------------------------------------------------------ chat */

  /* What somebody arriving is owed. A player is owed the table's conversation;
     a spectator is owed that and the rail's, merged back into the order it was
     said in, because two lists side by side read as two conversations. */
  private replayChatTo(userId: string): void {
    const lines = this.spectators.has(userId)
      ? [...this.playerChat, ...this.railChat].sort((a, b) => a.at - b.at)
      : this.playerChat;
    for (const line of lines) hub.send(userId, line);
  }

  /* One message. The allowance is spent here, synchronously, before anything
     is awaited: two messages arriving in the same tick would otherwise both
     pass a check made after a database round trip, and the gap that stops a
     flood would not exist. The name lookup follows, and only an accepted
     message is ever sent on or stored. */
  handleChat(userId: string, msg: Extract<ClientMsg, { t: 'chat' }>): void {
    if (!this.subscribers.has(userId)) {
      hub.send(userId, { t: 'err', c: 'no_match', msg: 'Join the table before chatting' });
      return;
    }
    const clean = cleanChatText(msg.text);
    if (!clean.ok) {
      hub.send(userId, { t: 'err', c: 'chat', msg: chatRejectionText(clean.reason!) });
      return;
    }
    const now = Date.now();
    const limited = this.chatLimiter.check(userId, now);
    if (limited) {
      hub.send(userId, {
        t: 'err',
        c: 'chat',
        msg: chatRejectionText(limited, this.chatLimiter.waitFor(userId, now)),
      });
      return;
    }
    this.chatLimiter.record(userId, now);
    void this.deliverChat(userId, clean.text, now).catch((err) => {
      console.error(`match ${this.id} chat failed:`, err);
    });
  }

  private async deliverChat(userId: string, text: string, at: number): Promise<void> {
    const user = await getUserById(userId);
    if (!user) return;
    // A bot only ever reaches here through its own `ChatProfile`
    // (`server/src/bots/population-roster.ts`), which is what keeps this to
    // the handful of sparing lines a bot is configured to say rather than
    // anything a table could provoke out of it.

    const seatIndex = this.playerIds.indexOf(userId);
    const seat = seatIndex === -1 ? null : seatIndex;
    const from: ChatFrom = { id: user.id, name: user.name, bot: shownAsBot(user.bot, this.match.format.practice === true), seat, avatarV: user.avatarV };
    const line: ChatLine = { t: 'chat', m: this.id, from, text, at };

    if (seat === null) {
      this.railChat = [...this.railChat, line].slice(-CHAT_HISTORY);
      for (const uid of this.spectators) hub.send(uid, line);
    } else {
      this.playerChat = [...this.playerChat, line].slice(-CHAT_HISTORY);
      for (const uid of this.subscribers) hub.send(uid, line);
    }

    await insertChatMessage({ matchId: this.id, userId, seat, text, at: new Date(at) });
  }

  handleAct(userId: string, msg: Extract<ClientMsg, { t: 'act' }>): void {
    if (!this.hand || this.match.status !== 'playing') {
      hub.send(userId, { t: 'err', c: 'no_match', msg: 'This match has no active hand' });
      return;
    }
    if (!this.playerIds.includes(userId)) {
      hub.send(userId, { t: 'err', c: 'not_your_turn', msg: 'Spectators cannot act' });
      return;
    }
    // Checked before the un-sit below, which is the whole difference between
    // the two states: a sat-out player is one action away from being back at
    // the table, and somebody who left is not.
    if (this.resigned.has(userId)) {
      hub.send(userId, { t: 'err', c: 'not_your_turn', msg: 'You left this match' });
      return;
    }
    // Any attempt to act un-sits a sat-out player, including one the room
    // rejects. `back` is the way in that does not have to be timed, but a
    // player who reaches the buttons first should not be folded for it.
    if (this.satOut.delete(userId)) this.timeoutStreak.set(userId, 0);
    const applied = this.hand.onAction(userId, msg);
    if (!applied) return; // the hand runner already sent the specific err
    this.timeoutStreak.set(userId, 0);
    this.rearmClock();
    this.broadcast();
    this.settleIfDone();
  }

  /* I am back: a sat-out player saying so without acting. It is its own
     message because acting is not a way back that can be timed. While they
     are away their decision is check-folded the instant it reaches them, so
     an `act` sent from a tab that has just woken up is answering a hand that
     has already moved on.

     A seat that is not sitting out is ignored rather than erred, and that is
     the whole of the abuse surface: `back` cannot reset a streak for free,
     and it cannot duck a heads-up forfeit, because heads-up never sits
     anybody out in the first place. If the decision is already theirs they
     get a fresh full clock, once, since a second `back` finds nothing to
     clear. */
  handleBack(userId: string, _msg: Extract<ClientMsg, { t: 'back' }>): void {
    if (this.match.status !== 'playing') return;
    // Somebody who left is sat out too, and this is the one door that must
    // not open for them: leaving is a decision with a rating and a walkout
    // strike attached, and a button on a stale tab cannot take it back.
    if (this.resigned.has(userId)) return;
    if (!this.satOut.delete(userId)) return;
    this.timeoutStreak.set(userId, 0);
    if (this.clock && this.playerIds[this.clock.seat] === userId) this.rearmClock();
    this.broadcast();
  }

  /* Spend this match's extra time, from the seat that is on the clock.

     Every refusal here is silent, the way `back`'s are: nothing was lost and
     nothing was decided, so there is no error a player could act on, and an
     `err` would only clear the client's own `sending` flag under a decision
     they are still in the middle of. The five doors it has to be shut to are
     the five ways it could be worth more than one turn of the clock:

     - a spectator, or anybody with no seat at this table;
     - somebody who has already spent theirs, which is the whole allowance;
     - a seat that is not the one to act, which would bank time against a
       decision that has not arrived and might never be theirs;
     - a clock that is not running, either because no one is on it (between
       hands, at showdown) or because it is paused for a reconnect, where
       moving the deadline would extend a window the grace timer owns;
     - a seat that is sitting out or has left, whose decision is check-folded
       on arrival rather than waited for.

     The deadline it moves is `this.clock`'s, which is the one the timer is
     armed against and the one `viewFor` reports, so the turn genuinely lasts
     longer rather than looking as if it does. The next decision opens on the
     format's own clock again: `rearmClock` reads `format.clockMs` and knows
     nothing about this. */
  handleExtra(userId: string, _msg: Extract<ClientMsg, { t: 'extra' }>): void {
    if (!this.hand || this.match.status !== 'playing') return;
    if (!this.playerIds.includes(userId)) return;
    if (this.extraLeft(userId) <= 0) return;
    if (this.satOut.has(userId) || this.resigned.has(userId)) return;
    const clock = this.clock;
    if (!clock || clock.paused) return;
    if (this.playerIds[clock.seat] !== userId) return;

    this.extraSpent.set(userId, (this.extraSpent.get(userId) ?? 0) + 1);
    const deadline = clock.deadline + EXTRA_TIME_MS;
    this.clearClockTimer();
    this.clock = { ...clock, deadline };
    this.armTimer(deadline, clock.seat);
    this.broadcast();
  }

  // What is left of one player's allowance. Anybody with no entry has all of
  // it, including a spectator, who is refused a seat away from here.
  private extraLeft(userId: string): number {
    return EXTRA_TIME_USES - (this.extraSpent.get(userId) ?? 0);
  }

  // Practice only: the human deciding to deal the next hand rather than wait
  // out the hold. A spectator's is dropped here, silently like a rejected
  // `next` from the hand runner itself; everything else (wrong hand, wrong
  // seat, no hold to answer) the hand runner ignores on its own. Whatever
  // happens next (a new hand dealt, or the match finished) reaches
  // subscribers through the hand runner's own `onChange`, not from here.
  handleNext(userId: string, msg: Extract<ClientMsg, { t: 'next' }>): void {
    if (!this.hand || this.match.status !== 'playing' || !this.playerIds.includes(userId)) return;
    this.hand.next(userId, msg);
  }

  /* Leaving the game, from the table's own control.

     This is a different message from `leave` on purpose. `leave` is the page
     unsubscribing and is sent on every unmount, so a route change, a reload
     or a tab close would forfeit a match somebody is still playing if the
     two shared a meaning. Somebody who has actually gone is covered by the
     disconnect grace, which is the mechanism that already exists for it.

     What it costs depends on the table, and the three answers are in
     `CLAUDE.md`. In short: a practice table ends, heads-up hands the match
     to the opponent, and a multiway table plays on without the seat. */
  handleResign(userId: string): void {
    if (!this.hand || this.match.status !== 'playing') {
      hub.send(userId, { t: 'err', c: 'no_match', msg: 'This match is over' });
      return;
    }
    if (!this.playerIds.includes(userId)) {
      hub.send(userId, { t: 'err', c: 'not_your_turn', msg: 'Spectators have no seat to leave' });
      return;
    }
    if (this.resigned.has(userId)) return; // said twice, costs once
    /* Already decided and waiting on its own settle. The result is on its way
       without any help, so there is nothing here for the button to do. */
    if (this.hand.isDone()) return;

    /* Knocked out, and watching the rest of the table play. There is no
       walkout to charge for that: they have a place already, and charging one
       for pressing the button after busting would be charging somebody for
       losing.

       It is still a leave, though, and that is what this used to get wrong.
       A multiway table has nothing to end for them and the client takes them
       back to the lobby itself, so returning was right there. **A practice
       table is the case it broke**: it exists for the one human sitting at
       it, the client deliberately does not navigate away from one because it
       is waiting to be shown a result, so a player who had busted out of a
       six handed practice table pressed Leave game and nothing happened at
       all, on the button or on the screen. */
    const placed = this.hand.currentPlaces()[userId] !== undefined;
    if (placed && !this.practice) return;

    if (!placed && !this.match.format.practice && this.playerIds.length > 2) this.pinLeavingPlace(userId);
    this.resigned.add(userId);
    if (!placed) this.chargeWalkoutIfRanked(userId);

    /* A practice table exists for the one human sitting at it, so there is
       nothing for it to play on for; heads-up has one opponent and the match
       is theirs. Either way the match is over now. */
    if (this.practice || this.playerIds.length === 2) {
      this.finishOnLeave(userId).catch((err) => this.abandon(err));
      return;
    }

    /* Multiway plays on. Forfeiting the match would hand the rest of the
       table a free elimination, which is the same argument that makes three
       timeouts a sit-out rather than a forfeit here, so leaving reuses that
       machinery exactly: every decision auto check-folded the instant it
       reaches the seat, blinds still posted, down to a bust like anyone
       else. The one difference is that it is permanent. */
    this.satOut.add(userId);
    // Rearmed before the broadcast, like everywhere else: a seat that has
    // just left may be the one to act, and the message that reports the
    // sit-out has to carry the clock that goes with it.
    this.rearmClock();
    this.broadcast();
  }

  /* Whether anybody else at this table is a person. A table of bots is
     nobody's to keep waiting, which is what lets a friend's link pull a
     player out of one (`vacate`). */
  otherHumans(userId: string): boolean {
    return this.match.seats.some((s) => s.userId !== userId && !s.bot);
  }

  /* Leaving for a table a friend has opened: a resign in every respect but
     one, there is no walkout to charge, because the only seats this leaves
     waiting are bots'. Refused, and false, when another person is at the
     table: their game is not the caller's to end. True when the seat has
     been given up, whether the table ends with it (practice, heads-up) or
     plays on without it (multiway, where the seat is placed last among those
     still in, exactly as a resign is).

     Resolves only once a table that ends with the leave has written its
     result, so the arranged game is never created beside a match row that
     still says `playing`. */
  async vacate(userId: string): Promise<boolean> {
    if (!this.playerIds.includes(userId) || this.otherHumans(userId)) return false;
    if (!this.hand || this.match.status !== 'playing') return true;
    if (this.resigned.has(userId)) return true;
    if (this.hand.isDone()) return true;
    const placed = this.hand.currentPlaces()[userId] !== undefined;
    if (placed && !this.practice) return true;
    if (!placed && !this.match.format.practice && this.playerIds.length > 2) this.pinLeavingPlace(userId);
    this.resigned.add(userId);
    if (this.practice || this.playerIds.length === 2) {
      await this.finishOnLeave(userId).catch((err) => this.abandon(err));
      return true;
    }
    this.satOut.add(userId);
    this.rearmClock();
    this.broadcast();
    return true;
  }

  /* Where somebody who is leaving a multiway table finishes: last among the
     seats that are still in and have not already left. Computed now rather
     than at the end, because "still in" is a fact about this moment and the
     table will have emptied by the time it is used.

     Two people leaving the same table take different places: the second one
     is not measured against the first, who is already out of the reckoning,
     so leaving later finishes higher. That is the same order the chips would
     have produced and it needs no tie to break. */
  private pinLeavingPlace(userId: string): void {
    const settled = this.hand?.currentPlaces() ?? {};
    const stillIn = this.playerIds.filter(
      (id) => settled[id] === undefined && (id === userId || !this.resigned.has(id))
    );
    this.leftPlaces.set(userId, stillIn.length);
  }

  /* The finishing order with the leavers put back where they belong. The
     seats that played on keep the order they actually finished in and are
     ranked around the fixed places rather than through them, so nothing
     about a real elimination is rewritten: what changes is only that a
     match somebody walked out of cannot be won by them.

     Ratings are recomputed rather than carried over, because a rating is a
     function of the places and these are not the places the hand runner
     rated. Untouched, and free, on the matches nobody left. */
  private async applyLeftPlaces(outcome: MatchOutcome): Promise<MatchOutcome> {
    if (this.leftPlaces.size === 0) return outcome;

    const fixed = new Map<number, string>();
    for (const [uid, place] of this.leftPlaces) fixed.set(place, uid);
    const rest = this.playerIds
      .filter((id) => !this.leftPlaces.has(id))
      .sort((a, b) => (outcome.places[a] ?? this.playerIds.length) - (outcome.places[b] ?? this.playerIds.length));

    const places: Record<string, number> = {};
    let next = 0;
    for (let place = 1; place <= this.playerIds.length; place++) {
      const leaver = fixed.get(place);
      if (leaver !== undefined) {
        places[leaver] = place;
        continue;
      }
      const id = rest[next];
      if (id === undefined) continue;
      next += 1;
      places[id] = place;
    }
    // Anything the walk could not seat (two leavers pinned to one place, if
    // that ever became possible) keeps what it had rather than losing a place
    // altogether.
    for (const id of this.playerIds) if (places[id] === undefined) places[id] = outcome.places[id] ?? this.playerIds.length;

    const winner = Object.entries(places).find(([, place]) => place === 1)?.[0] ?? null;
    return { ...outcome, winner, places, ratings: await this.rate(places) };
  }

  /* One rating period for this match's mode, from a finishing order. The
     three endings that build an outcome outside the hand runner all go
     through here: a rating is a function of the places, and three copies of
     what feeds it would drift the moment one of them gained a field. */
  private async rate(places: Record<string, number>): Promise<MatchOutcome['ratings']> {
    const standings = await getRatingsForUsers(this.playerIds, this.match.format.mode);
    const inputs = this.playerIds.map((uid) => {
      const r = standings.get(uid)!;
      return { userId: uid, rating: r.rating, rd: r.rd, volatility: r.volatility, ratingAt: r.ratingAt };
    });
    return computeMatchRatings(inputs, places, this.rated);
  }

  /* Only a rated match has a walkout to charge. Casual and practice are the
     rooms somebody is meant to be able to walk out of, and a bot forfeited by
     its own clock is a bug in the bot rather than a player to ban.

     Detached on purpose: the ban is a write about a person and the match is
     ending either way, so a database that refuses it must not take the
     result down with it. */
  private chargeWalkoutIfRanked(userId: string): void {
    if (!this.rated) return;
    void chargeWalkout(userId).catch((err) => {
      console.error(`match ${this.id} could not charge a walkout:`, err);
    });
  }

  private async finishOnLeave(leaverId: string): Promise<void> {
    await this.finishMatch(await this.buildLeaveOutcome(leaverId));
  }

  /* The outcome of a match ended by somebody leaving it. The people still in
     are placed by the stacks they are holding, best first, and the leaver
     goes last among them: anybody already eliminated finished before this
     happened and keeps the place they earned, which is why the settled
     places are read rather than recomputed.

     Heads-up this reduces to the forfeit outcome (opponent 1, leaver 2), so
     the two endings differ only in the `reason` they carry, which is the one
     thing the result panel needs them to differ in. */
  private async buildLeaveOutcome(leaverId: string): Promise<MatchOutcome> {
    const stacks = this.hand?.currentStacks() ?? {};
    const settled = this.hand?.currentPlaces() ?? {};
    const stillIn = this.playerIds.filter((id) => settled[id] === undefined);
    const others = stillIn
      .filter((id) => id !== leaverId)
      .sort((a, b) => (stacks[b] ?? 0) - (stacks[a] ?? 0));

    const places: Record<string, number> = { ...settled };
    others.forEach((id, i) => {
      places[id] = i + 1;
    });
    if (settled[leaverId] === undefined) places[leaverId] = stillIn.length;

    return { winner: others[0] ?? null, reason: 'left', stacks, places, ratings: await this.rate(places) };
  }

  // The decision clock. It is rearmed BEFORE the broadcast that reports the
  // state it belongs to, everywhere, because `viewFor` reads `this.clock`:
  // rearming afterwards sent every client the deadline of the seat that had
  // just acted, one decision behind, for the whole life of the table.
  //
  // A fresh clockMs window starts whenever toActSeat()
  // changes; it is armed with a real setTimeout to the deadline, and the
  // deadline is also mirrored into `clock` so viewFor can report it. While
  // the acting player is disconnected the timer itself is not running
  // (`paused: true` instead), handleGraceExpiry stands in for it.
  private rearmClock(): void {
    this.clearClockTimer();
    if (!this.hand) {
      this.clock = null;
      return;
    }
    const seat = this.hand.toActSeat();
    if (seat === null) {
      this.clock = null;
      return;
    }
    const userId = this.playerIds[seat];
    const away = userId !== undefined && this.disconnected.has(userId);
    // Somebody who left is never coming back to the buttons, so their seat
    // folds on arrival whether or not the tab is still open. A sat-out
    // player is the other case and is asked rather than folded.
    const gone = userId !== undefined && (away || this.resigned.has(userId));
    if (userId !== undefined && this.satOut.has(userId) && gone) {
      // Sat out AND away: fold (or check) immediately rather than burn a
      // clock nobody is watching. Deferred by a timer so a whole street of
      // sat-out seats unwinds as separate turns instead of recursing through
      // rearmClock. A sat-out player who is connected falls through to the
      // ordinary clock below: they can see they are sitting out and they are
      // being asked to come back, and folding them at nought milliseconds is
      // what left the owner unable to play his own hands.
      this.clock = { seat, deadline: Date.now(), paused: false };
      this.clockTimer = setTimeout(() => this.autoActSatOut(seat), 0);
      return;
    }
    // Paused only while the grace window is still open. Once grace has
    // expired the clock runs against a disconnected player, otherwise a
    // player who never comes back would freeze the match on their turn. A
    // practice table has no grace window and pauses for as long as the human
    // is away: the bots waiting on them do not mind.
    const paused = away && (this.practice || this.graceTimers.has(userId!));
    const deadline = Date.now() + this.match.format.clockMs;
    this.clock = { seat, deadline, paused };
    if (!paused) this.armTimer(deadline, seat);
  }

  private armTimer(deadline: number, seat: number): void {
    const delay = Math.max(0, deadline - Date.now());
    this.clockTimer = setTimeout(() => this.handleClockExpiry(seat), delay);
  }

  private clearClockTimer(): void {
    if (this.clockTimer) {
      clearTimeout(this.clockTimer);
      this.clockTimer = null;
    }
  }

  private handleClockExpiry(seat: number): void {
    const userId = this.playerIds[seat];
    if (!userId || !this.hand) return;
    this.hand.onTimeout(seat);
    const streak = (this.timeoutStreak.get(userId) ?? 0) + 1;
    this.timeoutStreak.set(userId, streak);
    // A practice table spends nothing: losing a match to a phone that went to
    // sleep is not a result, and there is nobody at that table to protect.
    const spent = streak >= TIMEOUT_STREAK_LIMIT && !this.practice;
    // Multiway: forfeiting one seat would hand the rest of the table a free
    // elimination, so the player is sat out and blinded off instead. Added
    // before the broadcast, so the message that reports the fold is also the
    // one that reports the sit-out.
    if (spent && this.playerIds.length > 2) this.satOut.add(userId);
    if (spent && this.playerIds.length === 2) {
      this.broadcast();
      // A forfeit is a walkout that was taken rather than chosen: the clock
      // ran out three times, or a connection never came back and the grace
      // window handed the expiry here. It costs the same, because it cost
      // the opponent the same.
      this.chargeWalkoutIfRanked(userId);
      const opponent = this.playerIds.find((id) => id !== userId) ?? null;
      this.forfeit(opponent).catch((err) => this.abandon(err));
      return;
    }
    this.rearmClock();
    this.broadcast();
    this.settleIfDone();
  }

  private autoActSatOut(seat: number): void {
    this.clockTimer = null;
    if (!this.hand || this.match.status !== 'playing') return;
    this.hand.onTimeout(seat);
    this.rearmClock();
    this.broadcast();
    this.settleIfDone();
  }

  private settleIfDone(): void {
    if (this.finishing) return; // already ending, by any route
    if (!this.hand?.isDone()) return;
    const outcome = this.hand.matchResult();
    if (!outcome) return;
    this.applyLeftPlaces(outcome)
      .then((settled) => this.finishMatch(settled))
      .catch((err) => this.abandon(err));
  }

  // Last resort for a room that cannot continue: the match row is gone, or
  // the database refused a write from a timer nobody is awaiting. Stop every
  // timer and drop the room from the registry rather than let the rejection
  // reach the process. There is no wire message for this, the same as the
  // boot-time abort: a client that comes back gets `no_match`.
  private abandon(err: unknown): void {
    this.clearClockTimer();
    for (const t of this.graceTimers.values()) clearTimeout(t);
    this.graceTimers.clear();
    this.hand = null;
    console.error(`match ${this.id} abandoned:`, err);
    unregisterRoom(this.id);
  }

  // Disconnect/reconnect and the grace window. A player has graceMs from the
  // moment their last socket drops before a pending decision is timed out on
  // their behalf; reconnecting inside that window clears the grace timer and
  // grants a fresh full decision clock (we do not track sub-second remaining
  // time across the pause, simpler, and indistinguishable to the player).
  handleDisconnect(userId: string): void {
    if (!this.playerIds.includes(userId) || this.match.status !== 'playing') return;
    this.disconnected.add(userId);
    if (this.clock && this.playerIds[this.clock.seat] === userId) {
      this.clearClockTimer();
      this.clock = { ...this.clock, paused: true };
    }
    this.broadcast(); // let the opponent see connected:false / paused right away
    /* A practice table has no grace window: the clock stays paused until the
       human comes back, however long that is. `rearmClock` reads `practice`
       for the same reason, so a decision that arrives while they are away
       waits rather than being folded.

       "However long that is" needed an end, though, and this is it. Waiting
       for somebody who closed the tab is not patience, it is a match left
       `playing` for good, five bots held out of the roster and a table the
       dashboards count as a live human one. The timer goes in the same map
       the grace timer would have, so reconnecting clears it by the route
       that already exists. */
    const away = this.practice
      ? setTimeout(() => this.handleAwayExpiry(userId), practiceAwayFor(this.match.format))
      : setTimeout(() => this.handleGraceExpiry(userId), this.match.format.graceMs);
    this.graceTimers.set(userId, away);
  }

  handleReconnect(userId: string): void {
    const timer = this.graceTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.graceTimers.delete(userId);
    }
    this.disconnected.delete(userId);
    if (this.clock && this.playerIds[this.clock.seat] === userId && this.clock.paused) {
      const deadline = Date.now() + this.match.format.clockMs;
      this.clock = { seat: this.clock.seat, deadline, paused: false };
      this.armTimer(deadline, this.clock.seat);
    }
    this.broadcast();
  }

  /* Practice only: the human has been away long enough that the table is not
     waiting any more. It ends the way they would have ended it themselves,
     `reason: 'left'`, because that is what happened, and it costs nothing:
     practice is never rated and there is no opponent it took a game from.

     A table held between hands is not exempt. The hold is the hand runner's
     and it waits on a `next` from the same person who is not here, so
     exempting it would be exempting exactly the table this is for. */
  private handleAwayExpiry(userId: string): void {
    this.graceTimers.delete(userId);
    if (!this.disconnected.has(userId)) return; // came back, nothing to do
    if (!this.hand || this.match.status !== 'playing') return;
    this.finishOnLeave(userId).catch((err) => this.abandon(err));
  }

  private handleGraceExpiry(userId: string): void {
    this.graceTimers.delete(userId);
    if (!this.disconnected.has(userId)) return; // reconnected already, nothing to do
    const seat = this.playerIds.indexOf(userId);
    if (seat === -1) return;
    this.handleClockExpiry(seat);
  }

  private async forfeit(winnerId: string | null): Promise<void> {
    const outcome = this.hand?.matchResult() ?? (await this.buildForfeitOutcome(winnerId));
    await this.finishMatch(outcome);
  }

  // Heads-up only: three consecutive timeouts hands the match to the
  // opponent before the hand runner ever reaches isDone(), so the outcome
  // (including the rating change) is built here instead of asked for.
  private async buildForfeitOutcome(winnerId: string | null): Promise<MatchOutcome> {
    const stacks = this.hand?.currentStacks() ?? {};
    const places: Record<string, number> = {};
    for (const uid of this.playerIds) places[uid] = winnerId === null ? 1 : uid === winnerId ? 1 : 2;

    return { winner: winnerId, reason: 'forfeit', stacks, places, ratings: await this.rate(places) };
  }

  async finishMatch(outcome: MatchOutcome): Promise<void> {
    if (this.finishing) return;
    this.finishing = true;
    this.clearClockTimer();
    for (const t of this.graceTimers.values()) clearTimeout(t);
    this.graceTimers.clear();
    // And whatever the hand runner is still waiting on. A match can end while
    // a practice hold is pending (nobody is coming to press the button) and
    // that hold's own timeout would otherwise resume into a finished match.
    this.hand?.stop();

    // Counters move for every finished match; the Glicko-2 state and a
    // rating_history row only for a rated one. Multiway has no draw: first
    // place is a win, every other place a loss.
    const multiway = this.playerIds.length > 2;
    const players = this.playerIds.map((uid) => {
      const r = outcome.ratings[uid];
      const place = outcome.places[uid] ?? this.playerIds.length;
      const result: 'win' | 'loss' | 'draw' = multiway
        ? place === 1
          ? 'win'
          : 'loss'
        : outcome.winner === null
          ? 'draw'
          : outcome.winner === uid
            ? 'win'
            : 'loss';
      return {
        userId: uid,
        place,
        outcome: result,
        rating: this.rated ? { rating: r.after, rd: r.rdAfter, volatility: r.volatility } : null,
      };
    });

    const rawRatings = toMatchResultRatings(outcome);
    await persistFinishMatch(this.id, {
      status: 'finished',
      mode: this.match.format.mode,
      rated: this.rated,
      winner: outcome.winner,
      reason: outcome.reason,
      finalStacks: outcome.stacks,
      places: outcome.places,
      ratings: rawRatings,
      players,
    });

    this.match = { ...this.match, status: 'finished', winner: outcome.winner, reason: outcome.reason };
    const result: MatchResult = {
      winner: outcome.winner,
      reason: outcome.reason,
      stacks: outcome.stacks,
      places: outcome.places,
      rated: this.rated,
      ratings: roundRatings(rawRatings),
    };
    this.lastResult = result;
    for (const uid of this.subscribers) hub.send(uid, { t: 'end', m: this.id, r: result });
    // After the result has been persisted and sent, so anything scoring off it
    // (the arena board) is reading a match that is finished everywhere else.
    emitMatchFinished({
      id: this.id,
      format: this.match.format,
      playerIds: this.playerIds,
      winner: outcome.winner,
      reason: outcome.reason,
      places: outcome.places,
    });
    setTimeout(() => unregisterRoom(this.id), ROOM_LINGER_MS);
  }
}
