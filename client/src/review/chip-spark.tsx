import type { ChipPoint } from '../net/types.ts';

const W = 400;
const H = 72;
const PAD = 3;

/* One seat's stack across the match, small-multiples rather than six lines
   overlaid on one chart. g-system's own six chart hues fail a measured CVD
   check at this exact job (deltaE 3.6 between #e93d82 and #12a594 under
   deuteranopia, and 8.4 between #46a758 and #12a594 even with ordinary
   colour vision, both under the 15 threshold), so identity here comes from
   the card the sparkline sits in, not from a hue: every seat draws in the
   same single accent, and "you" is heavier, not a different colour. Same
   bespoke-SVG reasoning as rating-graph.tsx, which this is modelled on
   directly, down to skipping a marker (a circle would stretch into an
   ellipse under preserveAspectRatio="none").

   The y scale is shared across every card on the page (`maxChips`, computed
   once in match-review.tsx), not auto-fit per seat: a seat that only ever
   held 200 units must draw shorter than one that ran to 800, or the shapes
   would compare two different scales as if they were one. */
export function ChipSpark({ seat, maxChips, you }: { seat: { chips: ChipPoint[]; finalStack: number | null }; maxChips: number; you: boolean }) {
  if (seat.chips.length < 2) {
    return <span className="muted">Not enough hands to chart.</span>;
  }
  const x = (hand: number, lastHand: number) =>
    PAD + (lastHand <= 1 ? 0 : ((hand - 1) / (lastHand - 1)) * (W - PAD * 2));
  const y = (chips: number) => PAD + (1 - chips / maxChips) * (H - PAD * 2);
  const lastHand = seat.chips[seat.chips.length - 1].hand;
  const d = seat.chips
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.hand, lastHand).toFixed(2)},${y(p.chips).toFixed(2)}`)
    .join(' ');
  const first = seat.chips[0].chips;
  const last = seat.finalStack ?? seat.chips[seat.chips.length - 1].chips;

  return (
    <div className="chip-spark">
      <div className="cs-graph">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Chip stack from ${first} to ${last} over ${seat.chips.length - 1} hands`}
        >
          <line x1={PAD} y1={y(0)} x2={W - PAD} y2={y(0)} className="cs-zero" />
          <path d={d} className="cs-line" data-mine={you ? '' : undefined} vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <div className="cs-figures num">
        <span className="cs-start">{first}</span>
        <span className="cs-end" data-sign={last > first ? 'up' : last < first ? 'down' : undefined}>{last}</span>
      </div>
    </div>
  );
}
