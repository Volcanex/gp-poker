import type { Mode, TournamentShape } from '@opentable/protocol';

/* The fixture calendar. Three fixtures, and this file is the only place that
   knows their names, their shapes, their seat caps or when they are played.
   Nothing else derives a schedule and nothing else writes a name: a page asks
   the server what is coming up and is told.

   Everything here is pure and in UTC. A start time is a number, a fixture is a
   record, and `nextStartAfter` is a function of the two, so the whole calendar
   is testable without a database, a clock or a tournament. The clock itself is
   the scheduler's seam (`configureTournaments`), not this file's: this file is
   asked "what comes after this instant", never "what time is it". */

export type TournamentKind = 'daily-bracket' | 'sunday-shootout' | 'monthly-championship';

export interface TournamentFixture {
  kind: TournamentKind;
  name: string;
  shape: TournamentShape;
  mode: Mode;
  seats: number;
  /* The one calm line the cards and the tournament page both print, so the
     two cannot describe the same fixture differently. */
  blurb: string;
  /* A second sentence, only where the schedule itself needs explaining. The
     daily's slot rotation is the one case: "every day at 20:00" would be a
     lie three days out of three. */
  note?: string;
  /* How many bots the population registers, at most, in the hour before the
     start. A floor rather than a target: people take the seats first and a
     bot is withdrawn to make room for anybody who wants one. */
  botFloor: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/* The daily bracket moves through three slots so that it lands in somebody's
   evening wherever they are: 20:00 for Europe, 02:00 for Asia and the
   Pacific, 11:00 for the Americas. One slot a day, by the day number, so the
   rotation needs no state and two processes agree on which slot today is. */
export const DAILY_SLOT_HOURS = [20, 2, 11];

export const FIXTURES: TournamentFixture[] = [
  {
    kind: 'daily-bracket',
    name: 'Daily bracket',
    shape: 'bracket',
    mode: 'heads-up',
    seats: 32,
    blurb: 'Thirty-two seats, heads-up, single elimination down to one.',
    note: 'The start time moves through three slots so it lands in the evening somewhere different each day.',
    botFloor: 16,
  },
  {
    kind: 'sunday-shootout',
    name: 'Sunday shootout',
    shape: 'shootout',
    mode: 'six-max',
    seats: 36,
    blurb: 'Six-max tables play down, the best of each go through, one table is the final.',
    botFloor: 24,
  },
  {
    kind: 'monthly-championship',
    name: 'Monthly championship',
    shape: 'shootout',
    mode: 'six-max',
    seats: 216,
    blurb: 'The largest field of the month. Six-max tables all the way to a final table.',
    botFloor: 48,
  },
];

export function fixtureFor(kind: string): TournamentFixture | null {
  return FIXTURES.find((f) => f.kind === kind) ?? null;
}

/* ------------------------------------------------------------- the calendar

   Three rules, each a function of a UTC instant and nothing else. */

// Which slot the daily bracket takes on this day number, where day 0 is the
// epoch. `mod 3` and no stored rotation: the day number is the state.
export function dailySlotHour(dayNumber: number): number {
  const i = ((dayNumber % DAILY_SLOT_HOURS.length) + DAILY_SLOT_HOURS.length) % DAILY_SLOT_HOURS.length;
  return DAILY_SLOT_HOURS[i];
}

function dailyStartOnDay(dayNumber: number): number {
  return dayNumber * DAY_MS + dailySlotHour(dayNumber) * HOUR_MS;
}

/* The next daily bracket strictly after `at`. The search starts a day early
   because a slot of 02:00 puts a day's fixture near the front of that day,
   so the day `at` falls in may still have its fixture ahead of it while the
   previous day's is already gone. */
function nextDailyAfter(at: number): number {
  const day = Math.floor(at / DAY_MS);
  for (let d = day - 1; d <= day + DAILY_SLOT_HOURS.length + 1; d++) {
    const start = dailyStartOnDay(d);
    if (start > at) return start;
  }
  // Unreachable: the loop covers more than one full rotation.
  return dailyStartOnDay(day + 1);
}

// The Sunday shootout and the monthly championship are both 18:00 on a Sunday.
const SUNDAY_HOUR = 18;

// Midnight UTC on the day `at` falls in.
function startOfDay(at: number): number {
  return Math.floor(at / DAY_MS) * DAY_MS;
}

function isFirstSundayOfMonth(at: number): boolean {
  const d = new Date(at);
  return d.getUTCDay() === 0 && d.getUTCDate() <= 7;
}

/* Every Sunday at 18:00 except the first of a month, which the championship
   takes. Walked a day at a time rather than computed, because "the first
   Sunday of the month" is a calendar question and the calendar is what
   `Date` is for; five weeks of iteration is nothing. */
function nextSundayShootoutAfter(at: number): number {
  for (let day = startOfDay(at); ; day += DAY_MS) {
    const start = day + SUNDAY_HOUR * HOUR_MS;
    if (start <= at) continue;
    if (new Date(start).getUTCDay() !== 0) continue;
    if (isFirstSundayOfMonth(start)) continue;
    return start;
  }
}

// The first Sunday of a month, 18:00. The one fixture with a field of 216.
function nextChampionshipAfter(at: number): number {
  for (let day = startOfDay(at); ; day += DAY_MS) {
    const start = day + SUNDAY_HOUR * HOUR_MS;
    if (start <= at) continue;
    if (!isFirstSundayOfMonth(start)) continue;
    return start;
  }
}

/* When this fixture is next played, strictly after `at`. The one function the
   scheduler calls, so the three rules above are the whole calendar and adding
   a fixture is a rule and a row in `FIXTURES`. */
export function nextStartAfter(kind: TournamentKind, at: number): number {
  if (kind === 'daily-bracket') return nextDailyAfter(at);
  if (kind === 'sunday-shootout') return nextSundayShootoutAfter(at);
  return nextChampionshipAfter(at);
}
