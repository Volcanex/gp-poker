import type { Card, MatchFormat, SeatView, TableView } from '@opentable/protocol';
import NumberFlow from '@number-flow/react';
import { PlayingCard } from './playing-card.tsx';
import { ChipStack } from './chip-stack.tsx';
import { TurnBar, TurnSeconds } from './turn-clock.tsx';
import { actionText, ordinal, shortName } from './labels.ts';
import { useFading } from '../ui/bits.tsx';
import { Avatar } from '../ui/avatar.tsx';
import { avatarVersion } from '../net/adapt.ts';
import { int } from '../ui/format.ts';

export interface SeatProps {
  seat: SeatView;
  you: boolean;
  clock: TableView['clock'];
  format: MatchFormat;
  reveal: Card[] | null; // hole cards from result.shown at a showdown
  n: number; // action seq, so a repeated action still re-shows its label
  handNo: number;
  dealAt?: number; // this seat's place in the deal, for the stagger
  seatCount?: number; // cards go round the table once before the second card
  origin?: { x: number; y: number }; // where this seat's cards are dealt from
  /* Showdown: the five cards that made the winning hand, and the name to put
     beside the seat once they are outlined. */
  best?: ReadonlySet<Card>;
  handLabel?: string | null;
  /* Chips are in the air: the stack shows the number it will settle on with no
     transition, because digits tumbling while a chip flies is the overlap the
     audit caught. */
  snap?: boolean;
}

export function Seat({
  seat, you, clock, format, reveal, n, handNo,
  dealAt = 0, seatCount = 1, origin, best, handLabel, snap,
}: SeatProps) {
  const acting = seat.acting;
  const onClock = clock && clock.seat === seat.i ? clock : null;
  const last = seat.last;
  const faded = useFading(last ? actionText(last.a, last.v) : null, `${handNo}:${n}:${seat.i}`);
  const label = handLabel ?? faded;
  const cards: (Card | null)[] = reveal ?? seat.cards ?? [null, null];
  /* Your own cards were never face down, so a showdown does not turn them over:
     they stay exactly where they are, which is the whole point of holding the
     hand on screen. Only somebody else's cards flip. */
  const turned = reveal != null && !you;

  return (
    <div
      className="seat"
      data-acting={acting ? '' : undefined}
      data-folded={seat.folded ? '' : undefined}
      data-out={seat.out ? '' : undefined}
    >
      {acting && onClock && (
        <TurnBar deadline={onClock.deadline} totalMs={format.clockMs} paused={onClock.paused} />
      )}

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

      <Avatar seed={seat.uid || seat.name} name={seat.name} size={28} avatarV={avatarVersion(seat.avatarV)} />

      <div className="seat-id">
        <span className="seat-line">
          <span className="seat-name" title={seat.name}>{shortName(seat.name, 16)}</span>
          {you && <span className="seat-you">you</span>}
          {/* Always here, hidden when the button is elsewhere: a marker that
              comes and goes moves every badge after it once a hand. */}
          <span className="btn-marker" title="Button" data-off={seat.button ? undefined : ''}>D</span>
          {seat.bot && <span className="seat-bot">bot</span>}
          {seat.rating > 0 && <span className="seat-rating num">{int(seat.rating)}</span>}
          {!seat.connected && <span className="seat-off">Disconnected</span>}
        </span>
        {seat.out ? (
          <span className="seat-stack num">
            {/* The same reserved slot the digits use, so a seat busting out
                does not move the word beside it. */}
            <span className="stack-v">{seat.place == null ? 'Out' : ordinal(seat.place)}</span>
            <span className="u">{seat.place == null ? '' : 'out'}</span>
          </span>
        ) : (
          <span className="seat-stack num">
            {/* The digits get a fixed slot so the word beside them does not
                slide every time a stack changes size. */}
            <span className="stack-v">
              {snap ? seat.stack : (
                <NumberFlow value={seat.stack} format={{ useGrouping: false }} respectMotionPreference />
              )}
            </span>
            <span className="u" data-allin={seat.allin ? '' : undefined}>
              {seat.allin ? 'all in' : 'units'}
            </span>
            {/* The big chips only, and never animated: this one says deep or
                short at a glance, it is not the thing being watched. */}
            <span className="stack-chips"><ChipStack amount={seat.stack} columns={3} /></span>
          </span>
        )}
      </div>

      <span className="seat-last">{label}</span>

      <span className="seat-clock">
        {acting && onClock && (
          <TurnSeconds deadline={onClock.deadline} totalMs={format.clockMs} paused={onClock.paused} />
        )}
      </span>
    </div>
  );
}
