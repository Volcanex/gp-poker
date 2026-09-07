const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const SHORT_DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

export function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : DATE.format(d);
}

export function fmtShortDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : SHORT_DATE.format(d);
}

export function fmtPct(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`;
}

/* Ratings and their deltas are whole numbers wherever they are shown. The
   server sends integers, but a fraction must never reach the screen: a rating
   delta once rendered as "+162.31089256906034", so the rounding lives at the
   display site rather than depending on the producer. */
export function int(n: number): number {
  return Math.round(n);
}

export function signed(n: number): string {
  const v = Math.round(n);
  return v > 0 ? `+${v}` : String(v);
}
