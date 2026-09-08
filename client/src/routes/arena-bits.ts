import { ARENA_FIRE_FROM, type ArenaStanding } from '@opentable/protocol';

/* The pure half of the arena page: the clock, the line the home page card
   reads, and the shape of the board. It is separate from the page for the
   reason the home game's seat layout is: the arithmetic of a countdown is
   worth testing without a browser in the way, and a countdown that lies is the
   one thing on this page nobody would notice until it mattered. */

export interface ArenaClock {
  kind: 'starts' | 'ends' | 'settling' | 'over';
  label: string;
}

export interface ArenaTimes {
  status: 'upcoming' | 'running' | 'finished';
  startsAt: string;
  endsAt: string;
}

/* The largest unit that still says something, and never two units where one
   will do. An arena is half an hour long and the next one is within the hour,
   so this counts hours at most. */
export function countdown(ms: number): string {
  const left = Math.max(0, ms);
  const secs = Math.round(left / 1000);
  if (secs < 60) return `${secs} sec`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/* What the hero card says about time. A running arena whose clock has already
   run out is not over: the matches paired before the end are played out and
   scored, and the board freezes when the last one settles, so it says so
   rather than counting into the negative. */
export function arenaClock(arena: ArenaTimes, now = Date.now()): ArenaClock {
  const starts = new Date(arena.startsAt).getTime();
  const ends = new Date(arena.endsAt).getTime();
  if (arena.status === 'finished') return { kind: 'over', label: 'Finished' };
  if (arena.status === 'upcoming') {
    if (starts <= now) return { kind: 'starts', label: 'Starting now' };
    return { kind: 'starts', label: `Starts in ${countdown(starts - now)}` };
  }
  if (ends <= now) return { kind: 'settling', label: 'Finishing the last matches' };
  return { kind: 'ends', label: `${countdown(ends - now)} left` };
}

/* The one line the home page card carries, so the card and the arena page
   cannot describe the same arena differently. */
export function arenaCardLine(arena: (ArenaTimes & { players: number }) | null, now = Date.now()): string {
  if (!arena) return 'The next arena is being scheduled.';
  const clock = arenaClock(arena, now);
  const joined = arena.players === 1 ? '1 player joined' : `${arena.players} players joined`;
  return `${clock.label}. ${joined}.`;
}

/* On fire: two wins already banked, so the next one is worth three. Read from
   the protocol's own threshold rather than a two written here, because the
   flame is a promise about what the server is about to pay. */
export function onFire(streak: number): boolean {
  return streak >= ARENA_FIRE_FROM;
}

export interface BoardRow {
  standing: ArenaStanding;
  you: boolean;
  // True when this row's rank does not follow the one above it, which is what
  // happens to your own row when you are outside the top twenty.
  gap: boolean;
}

/* The board as the table draws it. The server sends the top twenty with your
   own row appended when you are not in them, so the only work here is marking
   the break, and dropping a duplicate if a server ever sends you twice. */
export function boardRows(standings: ArenaStanding[], youUid: string | null): BoardRow[] {
  const seen = new Set<string>();
  const rows: BoardRow[] = [];
  let previous: number | null = null;
  for (const standing of standings) {
    if (seen.has(standing.uid)) continue;
    seen.add(standing.uid);
    rows.push({
      standing,
      you: standing.uid === youUid,
      gap: previous !== null && standing.rank > previous + 1,
    });
    previous = standing.rank;
  }
  return rows;
}

/* Win, draw, loss in one string, so a column that is three numbers reads as
   one number. Tabular, like every other count on the page. */
export function record(standing: ArenaStanding): string {
  return `${standing.wins}/${standing.draws}/${standing.losses}`;
}

/* Where a place sits on a podium, gold to bronze, for the finished arenas
   under the hero card. Anything past third is not a podium place. */
export function podiumLabel(place: number): string {
  if (place === 1) return 'First';
  if (place === 2) return 'Second';
  if (place === 3) return 'Third';
  return `Place ${place}`;
}
