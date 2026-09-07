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

export function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/* Rating and deviation always travel together: a rating without its deviation
   overstates how much is known about a player. */
export function ratingWithRd(rating: number, rd: number): string {
  return `${Math.round(rating)} +-${Math.round(rd)}`;
}
