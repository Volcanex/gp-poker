import type { Card, MatchFormat, SeatView, TableView } from '@opentable/protocol';
import NumberFlow from '@number-flow/react';
import { PlayingCard } from './playing-card.tsx';
import { TimerRing } from './timer-ring.tsx';
import { actionText, ordinal } from './labels.ts';
import { useFading } from '../ui/bits.tsx';
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
}

export function Seat({ seat, you, clock, format, reveal, n, handNo, dealAt = 0, seatCount = 1, origin }: SeatProps) {
  const acting = seat.acting;
  const onClock = clock && clock.seat === seat.i ? clock : null;
  const last = seat.last;
  const label = useFading(last ? actionText(last.a, last.v) : null, `${handNo}:${n}:${seat.i}`);
  const cards: (Card | null)[] = reveal ?? seat.cards ?? [null, null];

  return (
    <div
      className="seat"
      data-acting={acting ? '' : undefined}
      data-folded={seat.folded ? '' : undefined}
      data-out={seat.out ? '' : undefined}
    >
      <div className="seat-cards">
        {cards.map((c, i) => (
          <PlayingCard
            key={`${handNo}-${seat.i}-${i}`}
            card={c}
            index={dealAt + i * seatCount}
            dim={seat.folded}
            origin={origin}
          />
        ))}
      </div>

      <div className="seat-id">
        <span className="seat-line">
          <span className="seat-name">{seat.name}</span>
          {seat.bot && <span className="seat-bot">bot</span>}
          {you && <span className="seat-you">you</span>}
          {seat.rating > 0 && <span className="seat-rating num">{int(seat.rating)}</span>}
          {seat.button && <span className="btn-marker" title="Button">D</span>}
          {!seat.connected && <span className="seat-off">Disconnected</span>}
        </span>
        {seat.out ? (
          <span className="seat-stack num">
            {seat.place == null ? 'Out' : ordinal(seat.place)}
            <span className="u">{seat.place == null ? '' : 'out'}</span>
          </span>
        ) : (
          <span className="seat-stack">
            <NumberFlow value={seat.stack} respectMotionPreference />
            <span className="u">{seat.allin ? 'all in' : 'units'}</span>
          </span>
        )}
      </div>

      <span className="seat-last">{label}</span>

      <div className="seat-right">
        {onClock && (
          <TimerRing deadline={onClock.deadline} totalMs={format.clockMs} paused={onClock.paused} />
        )}
      </div>
    </div>
  );
}
