import { badgesFor, levelFor } from '@opentable/protocol';
import type { BadgeId, BadgeStats, Mode, ModeRating, UserSummary } from '@opentable/protocol';
import type {
  BotRow, Hand, Match, MatchHandSummary, MatchSeat, ModeStanding, Profile, RatingPoint,
  UserMatchSummary,
} from './types.ts';

/* Fields the server is adding but has not shipped yet: mean preflop accuracy
   and a total match count on /api/users/:name, and per-seat accuracy on the
   hands list of /api/matches/:id. Every reader goes through this file, so when
   the field names are confirmed there is one place to change and the UI above
   never learns a name. Absent and null both mean "no number to show", and the
   caller hides its tile or column rather than printing a zero. */

export function profileAccuracy(profile: Profile): number | null {
  return num(profile.accuracy);
}

/* Per-seat accuracy may arrive keyed by seat or indexed by seat; both read the
   same way here, so whichever the server picks needs no change upstream. */
export function handAccuracy(hand: MatchHandSummary, seat: number): number | null {
  const source = hand.accuracy;
  if (source == null) return null;
  return num(Array.isArray(source) ? source[seat] : source[seat] ?? source[String(seat) as unknown as number]);
}

/* True once any hand in the match carries an accuracy for any seat: the column
   appears with the data and stays away until then. */
export function matchHasAccuracy(match: Match): boolean {
  return match.hands.some((h) => match.seats.some((s) => handAccuracy(h, s.seat) != null));
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/* One standing per mode, the way a chess site keeps bullet and blitz apart.
   The map is on the wire now, but a client can outlive the server it talks to:
   without it, heads-up falls back to the flat fields (which are the heads-up
   standing) and any other mode reads as never played. Every rating shown
   outside a match comes through here. */
const FRESH: ModeRating = {
  rating: 1500, rd: 350, provisional: true, peak: 1500, peakAt: null,
  matches: 0, wins: 0, losses: 0, draws: 0,
};

export function modeRating(summary: UserSummary, mode: Mode): ModeRating {
  const map = summary.ratings as Partial<Record<Mode, ModeRating>> | undefined;
  const found = map?.[mode];
  if (found) return found;
  if (mode !== 'heads-up') return FRESH;
  return {
    ...FRESH,
    rating: summary.rating,
    rd: summary.rd,
    provisional: summary.provisional,
    peak: summary.rating,
  };
}

/* Wins over decided matches, drawn matches included in the denominator, which
   is how the server computes the one flat win rate it sends: the two can then
   never disagree on screen. Null when nothing has been decided yet. */
export function modeWinRate(r: ModeRating): number | null {
  const decided = r.wins + r.losses + r.draws;
  return decided > 0 ? r.wins / decided : null;
}

/* When a peak was set. The standing carries its own date now; the flat
   `peakAt` on the profile is the heads-up one and is the fallback for a server
   that predates the field. */
export function modePeakAt(profile: Profile, mode: Mode): string | null {
  const own = modeRating(profile.summary, mode).peakAt;
  if (own) return own;
  return mode === 'heads-up' ? profile.peakAt : null;
}

/* The mode a profile opens on: whichever the player has actually played, with
   the higher rating breaking a tie and heads-up when they have played neither.
   The server works it out now; the fallback is the same rule read off the
   standings, so a client talking to a server that predates the field still
   opens on the right mode rather than always on heads-up. Every mode switch on
   the page starts here, so a profile never opens showing a rating line for one
   mode beside insights for the other. */
export function mainMode(profile: Profile): Mode {
  const sent = profile.main;
  if (sent === 'heads-up' || sent === 'six-max') return sent;
  return mainModeOf(profile.summary);
}

/* The same rule off a bare summary, which is all the home page has: /api/me
   carries the standings but not the `main` the profile route works out. Used
   to pin the play panel to the game somebody actually plays, so it is the
   same answer their profile opens on rather than a second notion of it.

   Six handed wins a genuine tie, unlike the profile's fallback, because it is
   the main game: a player who has played neither is pinned to it. */
export function mainModeOf(summary: UserSummary): Mode {
  const sixMax = modeRating(summary, 'six-max');
  const headsUp = modeRating(summary, 'heads-up');
  if (sixMax.matches !== headsUp.matches) return sixMax.matches > headsUp.matches ? 'six-max' : 'heads-up';
  return headsUp.rating > sixMax.rating ? 'heads-up' : 'six-max';
}

/* Where this player sits in a mode. Null covers three different things that
   all mean the same on screen: a server that does not send standings, a mode
   with no rated match behind it, and a bot, which is not in the field at all.
   The page prints no percentile rather than a rank of zero. */
export function modeStanding(profile: Profile, mode: Mode): ModeStanding | null {
  const standing = profile.percentiles?.[mode];
  if (!standing) return null;
  if (standing.population < 1 || standing.rank < 1) return null;
  return standing;
}

/* A rating line is per mode too: a six-max result is not a point on a heads-up
   curve. A flat array is the old single-line shape and belongs to heads-up. */
export function ratingHistoryFor(profile: Profile, mode: Mode): RatingPoint[] {
  const h = profile.ratingHistory;
  if (Array.isArray(h)) return mode === 'heads-up' ? h : [];
  return h?.[mode] ?? [];
}

/* Seats the server has not flagged yet are people, not bots: the mark appears
   with the field and stays away until then. */
export function seatIsBot(seat: MatchSeat): boolean {
  return seat.bot === true;
}

/* A finishing position only reads as one with the size of the table beside it,
   so both fields have to be there before "1st of 6" can be said at all. */
export function matchPlacing(m: UserMatchSummary): { place: number; players: number } | null {
  const place = num(m.place);
  const players = num(m.players);
  if (place == null || players == null || place < 1 || players < 2) return null;
  return { place, players };
}

/* Absent is not "casual": a row that predates the field says nothing about
   which it was, and the tag stays off. */
export function matchRated(m: UserMatchSummary): boolean | null {
  return typeof m.rated === 'boolean' ? m.rated : null;
}

/* Practice and casual are both unrated, so the rated flag cannot tell them
   apart and the label has to come from here. A row with no flag was played
   before practice existed, which makes it casual. */
export function matchPractice(m: UserMatchSummary): boolean {
  return m.practice === true;
}

/* What the bots at one level are rated in one mode, for the practice picker.
   Averaged over the bots that have actually played the mode: a 1500 nobody
   earned is not form, so a level with no matches in that mode reads as null
   and the picker says so rather than printing a number. */
export function levelAverageRating(bots: BotRow[], level: number, mode: Mode): number | null {
  const played = bots.filter((b) => b.level === level && (b.ratings?.[mode]?.matches ?? 0) > 0);
  if (played.length === 0) return null;
  const total = played.reduce((sum, b) => sum + b.ratings[mode].rating, 0);
  return Math.round(total / played.length);
}

/* Engine seat index to table seat. A heads-up hand row carries no map because
   the two have always been the same thing, so the identity is the fallback. */
export function liveSeats(hand: Hand): number[] {
  const map = hand.live_seats;
  if (Array.isArray(map) && map.length > 0 && map.every((n) => Number.isInteger(n))) return map;
  return hand.seats.map((_, i) => i);
}

/* Starting stacks indexed the way the engine wants them, by live seat. The row
   holds one per table seat once a table is bigger than the hand (players are
   already out), and one per player otherwise; both read the same way for the
   heads-up rows, which is the only shape written so far. */
export function startStacks(hand: Hand, seatMap: number[]): number[] {
  const perTableSeat = hand.stacksStart.length > seatMap.length;
  return seatMap.map((seat, engineIndex) => hand.stacksStart[perTableSeat ? seat : engineIndex] ?? 0);
}

/* An avatar is drawn from an id, because a name can be claimed and changed and
   the picture should not change with it. Two payloads carried names only until
   the server started sending ids, and a row written before that has nothing
   else to go on: seeding on the name keeps a picture on the screen, and it
   settles to the id the moment one arrives. */
export function avatarSeed(id: string | undefined, name: string): string {
  return id && id.length > 0 ? id : name;
}

/* Which version of somebody's uploaded picture to ask for. Zero means they
   have none and the generated avatar is the whole answer; absent means the
   server predates pictures, which reads the same way. Every <Avatar> takes
   this rather than a URL, so the one place that knows how a picture is
   addressed is the component that draws it. */
export function avatarVersion(v: number | null | undefined): number {
  return typeof v === 'number' && v > 0 ? v : 0;
}

/* ---------------------------------------------------------------- level

   How many matches somebody has finished, everything included: rated, casual
   and practice, in every mode and at both speeds. The per-mode counters are
   what the server already sends, so a total is a sum rather than a field, and
   nothing on the wire has to be kept in step with it.

   Level is the curve over that total, and the curve lives in the protocol so
   the profile, the top bar and the server's own tests read one definition. */
const ALL_MODES: Mode[] = ['six-max', 'heads-up'];

export function totalMatches(summary: UserSummary): number {
  return ALL_MODES.reduce((sum, mode) => sum + modeRating(summary, mode).matches, 0);
}

export function levelOf(summary: UserSummary): number {
  return levelFor(totalMatches(summary));
}

/* What a badge is decided from, gathered off the profile payload. `hands` is
   the count the accuracy line is already averaged over, and the six handed
   wins are the counter on that mode's standing, so a badge is a reading of
   numbers already on the page rather than a row somebody had to write. */
export function badgeStats(profile: Profile): BadgeStats {
  return {
    matches: totalMatches(profile.summary),
    hands: profile.stats?.hands ?? 0,
    sixMaxWins: modeRating(profile.summary, 'six-max').wins,
  };
}

export function profileBadges(profile: Profile): BadgeId[] {
  return badgesFor(badgeStats(profile));
}
