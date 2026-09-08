/* What the shading on a grid means, drawn from the same ramp functions the
   cells are, so the two cannot drift. Both grid pages render one, always, in a
   slot of fixed height: a legend that appears and disappears with the view
   would move the panel beside it every time somebody changed the shading. */

import { rampFill, rampHue, HEAT_CAP } from './ramp.ts';

/* Seven, not six, so a diverging ramp has a swatch at true zero in the middle
   rather than two faint ones either side of a gap. */
const STOPS = [0, 1 / 6, 2 / 6, 0.5, 4 / 6, 5 / 6, 1];

export interface GridLegendProps {
  /* Read left to right, coolest first. */
  from: string;
  to: string;
  /* A diverging ramp runs out from the middle in both directions, so the
     swatches take their tone from the side of centre they fall on. */
  tones?: [string, string];
  cap?: number;
  /* A line under the ramp for the view that has no ramp at all. */
  note?: string;
}

export function GridLegend({ from, to, tones, cap = HEAT_CAP, note }: GridLegendProps) {
  return (
    <div className="grid-legend">
      <span className="muted small">{from}</span>
      <span className="grid-ramp" aria-hidden="true">
        {STOPS.map((stop) => {
          const t = tones ? Math.abs(stop * 2 - 1) : stop;
          return (
            <span
              key={stop}
              className="grid-swatch"
              data-tone={tones ? (stop >= 0.5 ? tones[1] : tones[0]) : 'heat'}
              style={{ '--_f': rampFill(t, cap), '--_h': rampHue(t) } as React.CSSProperties}
            />
          );
        })}
      </span>
      <span className="muted small">{to}</span>
      {note ? <span className="muted small grid-legend-note">{note}</span> : null}
    </div>
  );
}

/* The same slot, for a view whose selection is one colour rather than a ramp.
   It exists so the row keeps its height when a page switches between the two:
   the panel beside the grid must not step up and down. */
export function FlatLegend({ label, note }: { label: string; note?: string }) {
  return (
    <div className="grid-legend">
      <span className="grid-ramp" aria-hidden="true">
        <span className="grid-swatch" data-tone="on" />
      </span>
      <span className="muted small">{label}</span>
      {note ? <span className="muted small grid-legend-note">{note}</span> : null}
    </div>
  );
}
