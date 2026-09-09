/* One representative IANA timezone per country a population bot can be
   assigned, so a bot's schedule runs on a clock consistent with where it
   says it is from. Approximate on purpose: a country spanning several zones
   (the US, Russia, Brazil, Canada, Australia) gets its most populous one
   rather than a full per-region breakdown, which is honest enough for
   "an evening peak in this bot's local time" and not worth the extra table.

   Every code here must also appear in `../countries.ts`, the list a human
   may set as their own flag; `population.test.ts` checks it. */
export const COUNTRY_TIMEZONE: Record<string, string> = {
  us: 'America/New_York',
  gb: 'Europe/London',
  ca: 'America/Toronto',
  de: 'Europe/Berlin',
  br: 'America/Sao_Paulo',
  ru: 'Europe/Moscow',
  au: 'Australia/Sydney',
  nl: 'Europe/Amsterdam',
  se: 'Europe/Stockholm',
  pl: 'Europe/Warsaw',
  fr: 'Europe/Paris',
  es: 'Europe/Madrid',
  it: 'Europe/Rome',
  ua: 'Europe/Kyiv',
  hu: 'Europe/Budapest',
  fi: 'Europe/Helsinki',
  no: 'Europe/Oslo',
  at: 'Europe/Vienna',
  ar: 'America/Argentina/Buenos_Aires',
  mx: 'America/Mexico_City',
  in: 'Asia/Kolkata',
  jp: 'Asia/Tokyo',
  ie: 'Europe/Dublin',
  pt: 'Europe/Lisbon',
  ro: 'Europe/Bucharest',
  cz: 'Europe/Prague',
  be: 'Europe/Brussels',
  ch: 'Europe/Zurich',
  dk: 'Europe/Copenhagen',
  tr: 'Europe/Istanbul',
  cn: 'Asia/Shanghai',
  kr: 'Asia/Seoul',
  ph: 'Asia/Manila',
  id: 'Asia/Jakarta',
  il: 'Asia/Jerusalem',
  gr: 'Europe/Athens',
  za: 'Africa/Johannesburg',
  nz: 'Pacific/Auckland',
  cl: 'America/Santiago',
  co: 'America/Bogota',
};

const DEFAULT_TIMEZONE = 'UTC';

export function timezoneFor(country: string): string {
  return COUNTRY_TIMEZONE[country] ?? DEFAULT_TIMEZONE;
}

/* Local hour (0-23) and weekday (0 Sunday - 6 Saturday) for an instant in a
   timezone, via Intl rather than a hand-rolled UTC offset table: it gets
   DST right for free, which a fixed-offset map would not. `Intl` formats
   are the only thing here that can throw (an unknown zone id), which is why
   `timezoneFor` above always falls back to a zone that exists rather than
   letting a bad country code reach this. */
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface LocalTime {
  hour: number; // 0-23
  minute: number; // 0-59
  weekday: number; // 0 Sunday .. 6 Saturday
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(timezone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
      hour12: false,
    });
    formatterCache.set(timezone, fmt);
  }
  return fmt;
}

export function localTimeAt(timezone: string, at: Date): LocalTime {
  const parts = formatterFor(timezone).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  // hour12: false still reports midnight as "24" on some ICU builds; 24 % 24
  // is the zero it means.
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  const weekdayName = get('weekday');
  const weekday = WEEKDAYS.indexOf(weekdayName);
  return { hour, minute, weekday: weekday === -1 ? 0 : weekday };
}
