import type { Card, MatchFormat, SeatView, TableView } from '@opentable/protocol';
import { PlayingCard } from './playing-card.tsx';
import { ChipStack } from './chip-stack.tsx';
import { TurnBar, TurnSeconds } from './turn-clock.tsx';
import { actionWords, ordinal, shortName } from './labels.ts';
import { Avatar } from '../ui/avatar.tsx';
import { avatarVersion } from '../net/adapt.ts';
import { FlagSlot } from '../ui/flag.tsx';

export interface SeatProps {
  seat: SeatView;
  you: boolean;
  clock: TableView['clock'];
  format: MatchFormat;
  reveal: Card[] | null; // hole cards from result.shown at a showdown
  handNo: number;
  dealAt?: number; // this seat's place in the deal, for the stagger
  seatCount?: number; // cards go round the table once before the second card
  origin?: { x: number; y: number }; // where this seat's cards are dealt from
  /* Showdown: the five cards that made the winning hand. */
  best?: ReadonlySet<Card>;
}

/* One card, one row, one edge. Left to right: the avatar, the two cards, the
   identity block with the name and the stack right-aligned against the
   action square, and the square itself on the seat's right edge.

   The square is the seat's height and always drawn, empty as a quiet outline,
   so a word arriving in it moves nothing. It holds what the player last did
   for the whole street (the view clears `last` when the next street deals;
   a fold keeps it to the end of the hand) and, while the seat is acting, the
   countdown instead, with the clock's bar along its bottom edge.

   The stack's chips stand beside its figure and tick as the stack changes:
   a bet is these chips leaving and the pot's arriving. The figure snaps. */
export function Seat({
  seat, you, clock, format, reveal, handNo,
  dealAt = 0, seatCount = 1, origin, best,
}: SeatProps) {
  const acting = seat.acting;
  const onClock = clock && clock.seat === seat.i ? clock : null;
  const last = seat.last ? actionWords(seat.last.a, seat.last.v) : null;
  const cards: (Card | null)[] = reveal ?? seat.cards ?? [null, null];
  /* Your own cards were never face down, so a showdown does not turn them over:
     they stay exactly where they are, which is the whole point of holding the
     hand on screen. Only somebody else's cards flip. */
  const turned = reveal != null && !you;
  const clocked = acting && onClock != null;

  return (
    <div
      className="seat"
      data-acting={acting ? '' : undefined}
      data-folded={seat.folded ? '' : undefined}
      data-out={seat.out ? '' : undefined}
    >
      <Avatar seed={seat.uid || seat.name} name={seat.name} size={28} avatarV={avatarVersion(seat.avatarV)} />

      <div className="seat-cards">
        {cards.map((c, i) => (
          <PlayingCard
            /* Turning face up is a remount, which is what makes the flip run
               where the card already lies rather than dealing it again. */
            key={`${handNo}-${seat.i}-${i}-${turned ? 'up' : 'down'}`}
            card={c}
            index={dealAt + i * seatCount}
            dim={seat.folded}
            best={c != null && best != null && best.has(c)}
            flip={turned}
            origin={origin}
          />
        ))}
      </div>

      <div className="seat-id">
        <span className="seat-line">
          {/* Always here, empty when the player has no flag: the same reserved
              slot the button marker keeps, and for the same reason. */}
          <FlagSlot code={seat.country} size={16} />
          <span className="seat-name" title={seat.name}>{shortName(seat.name, 16)}</span>
          {you && <span className="seat-you">You</span>}
          {/* Always here, hidden when the button is elsewhere: a marker that
              comes and goes moves every badge after it once a hand. */}
          <span className="btn-marker" title="Button" data-off={seat.button ? undefined : ''}>D</span>
          {seat.bot && <span className="seat-bot seat-bot-line">Bot</span>}
          {!seat.connected && <span className="seat-off">Disconnected</span>}
        </span>
        {seat.out ? (
          <span className="seat-stack num">
            <span className="u">{seat.place == null ? '' : 'out'}</span>
            {/* The same reserved slot the digits use, so a seat busting out
                does not move the word beside it. */}
            <span className="stack-v">{seat.place == null ? 'Out' : ordinal(seat.place)}</span>
          </span>
        ) : (
          <span className="seat-stack num">
            <span className="stack-chips"><ChipStack amount={seat.stack} /></span>
            {/* The badge is drawn twice and CSS keeps one: on a phone the name
                line has no room for it and the stack line has plenty. */}
            {seat.bot && <span className="seat-bot seat-bot-stack">Bot</span>}
            {/* Out of the flow, in a slot the chips leave open: Chrome's
                layout-shift observer gives a box that has never painted a
                stale rect and reports it moving when its word arrives, so
                the word is a new node when it arrives and nothing is
                measured before it. */}
            {seat.allin && <span className="u" data-allin="">all in</span>}
            {/* The digits get a fixed slot so the chips beside them do not
                slide every time a stack changes size. */}
            <span className="stack-v" key={seat.stack}>{seat.stack}</span>
          </span>
        )}
      </div>

      <span
        className="seat-act"
        data-tone={clocked ? 'clock' : last?.tone}
        data-empty={!clocked && !last ? '' : undefined}
      >
        {clocked ? (
          <>
            <TurnSeconds deadline={onClock.deadline} totalMs={format.clockMs} paused={onClock.paused} />
            <TurnBar deadline={onClock.deadline} totalMs={format.clockMs} paused={onClock.paused} />
          </>
        ) : last ? (
          <>
            <span className="act-w" key={last.word}>{last.word}</span>
            <span className="act-v num" key={last.amount ?? 0}>{last.amount ?? '\u00a0'}</span>
          </>
        ) : null}
      </span>
    </div>
  );
}
