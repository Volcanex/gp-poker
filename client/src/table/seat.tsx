import type { Card, MatchFormat, SeatView, TableView } from '@opentable/protocol';
import NumberFlow from '@number-flow/react';
import { PlayingCard } from './playing-card.tsx';
import { TimerRing } from './timer-ring.tsx';
import { actionText } from './labels.ts';
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
}

export function Seat({ seat, you, clock, format, reveal, n, handNo }: SeatProps) {
  const acting = seat.acting;
  const onClock = clock && clock.seat === seat.i ? clock : null;
  const last = seat.last;
  const label = useFading(last ? actionText(last.a, last.v) : null, `${handNo}:${n}:${seat.i}`);
  const cards: (Card | null)[] = reveal ?? seat.cards ?? [null, null];

  return (
    <div className="seat" data-acting={acting ? '' : undefined} data-folded={seat.folded ? '' : undefined}>
      <div className="seat-cards">
        {cards.map((c, i) => (
          <PlayingCard key={`${handNo}-${seat.i}-${i}`} card={c} index={i} dim={seat.folded} />
        ))}
      </div>

      <div className="seat-id">
        <span className="seat-line">
          <span className="seat-name">{seat.name}</span>
          {you && <span className="seat-you">you</span>}
          {seat.rating > 0 && <span className="seat-rating num">{int(seat.rating)}</span>}
          {seat.button && <span className="btn-marker" title="Button">D</span>}
          {!seat.connected && <span className="seat-off">Disconnected</span>}
        </span>
        <span className="seat-stack">
          <NumberFlow value={seat.stack} respectMotionPreference />
          <span className="u">{seat.allin ? 'all in' : 'units'}</span>
        </span>
      </div>

      <div className="seat-right">
        {label && <span className="seat-last">{label}</span>}
        {onClock && (
          <TimerRing deadline={onClock.deadline} totalMs={format.clockMs} paused={onClock.paused} />
        )}
      </div>
    </div>
  );
}
