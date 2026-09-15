import type { Card, MatchFormat, SeatView, TableView } from '@opentable/protocol';
import { PlayingCard } from './playing-card.tsx';
import { ChipStack } from './chip-stack.tsx';
import { TurnBar, TurnSeconds } from './turn-clock.tsx';
import { actionWords, ordinal, shortName } from './labels.ts';
import { Avatar } from '../ui/avatar.tsx';
import { avatarVersion } from '../net/adapt.ts';
import { FlagSlot } from '../ui/flag.tsx';
import { int } from '../ui/format.ts';

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
  /* The small blind at this level. It is the rack's colour-up signal and
     nothing else: chips are held between levels and re-laid at one, so this
     changing is the one thing that redraws a stack rather than moving chips
     around inside it. See `./chips.ts`. */
  blind?: number;
  /* This seat took a share of the pot. The whole seat is lit for it, not just
     its cards: who won is the one thing being read at a showdown, and five
     highlighted cards spread across the felt say what the hand was rather
     than who is holding it. */
  won?: boolean;
}

/* One card, one row, one edge. Left to right: the picture on the seat's outer
   edge, the two cards, the identity block right-aligned against the action
   square, and the square itself on the seat's right edge.

   The identity block is two rows, both ending on the same edge: the name with
   its flag and its badges, and under it the stack's figure with the rack it is
   worth beside it. Two rows and not three, and the rack beside the figure and
   not under it: a rack and a number are one reading, and a seat that spends a
   third of its height splitting them reads as a box with a name in a corner.

   The square is the seat's height and always drawn, empty as a quiet outline,
   so a word arriving in it moves nothing. It holds what the player last did
   for the whole street (the view clears `last` when the next street deals;
   a fold keeps it to the end of the hand) and, while the seat is acting, the
   countdown instead, with the clock's bar along its bottom edge.

   The stack's chips stand beside its figure and tick as the stack changes:
   a bet is these chips leaving and the pot's arriving. The figure snaps. */
export function Seat({
  seat, you, clock, format, reveal, handNo,
  dealAt = 0, seatCount = 1, origin, best, won = false, blind,
}: SeatProps) {
  const acting = seat.acting;
  const onClock = clock && clock.seat === seat.i ? clock : null;
  /* A call and an all in carry no figure in the action log, so the square
     reads the seat's street bet for them: "Calls 30" is what the seat has
     matched, which is the number the table is reading. */
  const lastValue = seat.last?.v ?? ((seat.last?.a === 'c' || seat.last?.a === 'a') && seat.bet > 0 ? seat.bet : undefined);
  const last = seat.last ? actionWords(seat.last.a, lastValue) : null;
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
      data-won={won ? '' : undefined}
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
        {/* Who they are, and what is true of the seat they are in: the flag
            slot, the name, the rating, the button marker and the bot tag, all
            ending on the block's own edge. Only the name may shrink. */}
        <span className="seat-line">
          {/* Always here, empty when the player has no flag: the same reserved
              slot the button marker keeps, and for the same reason. */}
          <FlagSlot code={seat.country} size={16} />
          <span className="seat-name" title={seat.name}>{shortName(seat.name, 16)}</span>
          <span className="seat-rating num">{int(seat.rating)}</span>
          {you && <span className="seat-you">You</span>}
          {/* Always here, hidden when the button is elsewhere: a marker that
              comes and goes moves every badge after it once a hand. */}
          <span className="btn-marker" title="Button" data-off={seat.button ? undefined : ''}>D</span>
          {seat.bot && <span className="seat-bot">Bot</span>}
          {!seat.connected && <span className="seat-off">Disconnected</span>}
        </span>

        {/* The figure and the rack it is worth, on one line under the name.
            Keyed apart from each other, so busting out remounts the row rather
            than retyping a live figure into a placing; a retyped node is one
            the layout-shift observer can measure. An empty stack still draws
            every denomination's empty slot, so a seat busting out keeps this
            row's height exactly as a full one has it: that reserved box is
            what held the last shift on the six-max footprint. */}
        {seat.out ? (
          <span className="seat-stack num" key="out">
            <span className="seat-chips"><ChipStack amount={0} level={blind} /></span>
            {/* The square says "Out" now (below), so this slot is left to the
                placing alone, or to "Out" itself while it is still pending. */}
            <span className="u u-allin"></span>
            <span className="stack-v">{seat.place == null ? 'Out' : ordinal(seat.place)}</span>
          </span>
        ) : (
          <span className="seat-stack num" key="live">
            <span className="seat-chips"><ChipStack amount={seat.stack} level={blind} /></span>
            {/* Out of the flow, in a slot the chips always leave open, and
                always rendered: a node that mounts when the word arrives is a
                node Chrome's layout-shift observer can give a stale rect, and
                it did, on six-max at 1280. An empty box that was always there
                has nothing to move from. */}
            <span className="u u-allin">{seat.allin ? 'All in' : ''}</span>
            <span className="stack-v" key={seat.stack}>{seat.stack}</span>
          </span>
        )}
      </div>

      <span
        className="seat-act"
        data-tone={seat.out ? undefined : clocked ? 'clock' : last?.tone}
        data-empty={!seat.out && !clocked && !last ? '' : undefined}
      >
        {seat.out ? (
          <span className="act-w">Out</span>
        ) : clocked ? (
          <>
            <TurnSeconds deadline={onClock.deadline} totalMs={format.clockMs} paused={onClock.paused} />
            <TurnBar deadline={onClock.deadline} totalMs={format.clockMs} paused={onClock.paused} />
          </>
        ) : last ? (
          <>
            <span className="act-w" key={last.word}>{last.word}</span>
            {/* Only when there is a figure: a check or a fold's word is the
                whole of what happened, and a blank second line under it was
                reserved space nobody could see, pushing the word that always
                shows off the square's actual middle. */}
            {last.amount != null && (
              <span className="act-v num" key={last.amount}>{last.amount}</span>
            )}
          </>
        ) : null}
      </span>
    </div>
  );
}
