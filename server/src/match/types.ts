import type { ClientMsg, MatchResult, TableView } from '@opentable/protocol';

export interface RoomClock {
  seat: number;
  deadline: number; // epoch ms
  paused: boolean;
}

// Everything finishMatch needs to persist and to report, richer than the
// wire-level MatchResult because it carries the Glicko-2 volatility that
// never goes out over the wire. Constructed by whoever decides the match is
// over: the hand runner (bust / hands exhausted) or MatchRoom itself (three
// consecutive timeouts).
export interface MatchOutcome {
  winner: string | null;
  reason: MatchResult['reason'];
  stacks: Record<string, number>;
  // Finishing position per user id, 1 = best. Always filled: heads-up gives
  // the winner 1 and the loser 2 (both 1 on a draw), multiway gives reverse
  // elimination order.
  places: Record<string, number>;
  ratings: Record<string, { before: number; after: number; rdBefore: number; rdAfter: number; volatility: number }>;
}

/* The seam between orchestration and game state. MatchRoom owns
   subscribers, the wall clock, disconnect grace, persistence and rating
   writeback on finish, and never touches a HandState directly, only
   through this interface. viewFor takes the room's clock and connectivity
   state as parameters rather than the hand runner tracking disconnects
   itself: masking hole cards is the engine's job, but whose turn it is on
   the wall clock, and who is currently connected, are orchestration
   concerns the hand runner shouldn't need to know about. */
export interface HandRunner {
  startHand(number: number): Promise<void>;
  // Returns whether the action actually changed state. A rejected action
  // (wrong turn, stale seq, illegal amount, malformed message) sends its own
  // `err` directly and returns false so the room doesn't rebroadcast or
  // rearm the clock over nothing, armed clock resets are exactly the
  // exploit a client spamming illegal actions would otherwise get for free.
  onAction(userId: string, msg: Extract<ClientMsg, { t: 'act' }>): boolean;
  // Called by the room's clock on expiry. Applies 'x' if legal for this
  // seat, else 'f', logging the action with `to: true`.
  onTimeout(seat: number): void;
  // Practice only: the human asking to deal the next hand (or finish the
  // match) instead of waiting out the hold. A no-op everywhere else: a
  // non-practice table was never waiting, and a stale hand number, a
  // spectator or a seat that is not the human is ignored rather than erred,
  // the same way a late `act` on a hand that has moved on is.
  next(userId: string, msg: Extract<ClientMsg, { t: 'next' }>): void;
  // Seat numbers crossing this interface are always TABLE seats (0..N-1,
  // fixed for the match). The runner maps them onto the engine's live-seat
  // config in both directions.
  toActSeat(): number | null; // null when no decision is pending (between hands, at showdown)
  isDone(): boolean; // true once the whole MATCH is decided (bust or hands played out), not just the current hand
  matchResult(): MatchOutcome | null; // non-null once isDone()
  currentStacks(): Record<string, number>; // live stacks, for a forced forfeit that isn't isDone()
  viewFor(userId: string | null, clock: RoomClock | null, connected: boolean[]): TableView | null;
}
