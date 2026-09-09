/* The population's roster: who each bot is, once and for all, generated
   deterministically from a fixed seed the same way the old fifteen-bot
   roster was. Pure, no database and no clock beyond the `Date` a caller
   passes in, so it can be unit tested without a server.

   Growing `POPULATION_SIZE` only appends, exactly like the old roster:
   `generateRealisticIdentity` is drawn from the same rng sequence every
   time, so bot 0 is always bot 0 no matter how many more are asked for. */

import { generateRealisticIdentity, seededRng, type Rng } from '@opentable/identity';
import type { BotLevel, Mode, Speed } from '@opentable/protocol';
import { jitteredPersona, ARCHETYPES, type Archetype, type Persona } from './persona.js';
import { timezoneFor, localTimeAt } from './geography.js';

export type ActivityTier = 'grinder' | 'regular' | 'casual';

export interface WeeklyBudget {
  tier: ActivityTier;
  hoursPerWeek: number;
  sessionMinutes: [number, number];
}

// One online window in the bot's own local time, recurring every week.
// `day` is 0 Sunday .. 6 Saturday, `startMinute` is minutes after local
// midnight, and a session may run past midnight (`isOnlineAt` in
// population.ts handles the wrap).
export interface Session {
  day: number;
  startMinute: number;
  durationMinutes: number;
}

export interface ChatProfile {
  chattiness: number; // 0..1, chance of saying anything at all in a match
  greeting: string | null;
  farewell: string | null;
}

export interface PopulationBot {
  index: number;
  name: string;
  country: string;
  timezone: string;
  level: BotLevel;
  persona: Persona;
  budget: WeeklyBudget;
  // 24 weights, index = local hour of day. Not normalised: only relative
  // size matters.
  preferredHours: number[];
  // 7 weights, index = local weekday, 0 Sunday .. 6 Saturday.
  preferredDays: number[];
  mode: Mode;
  speed: Speed;
  chat: ChatProfile;
  // A fixed, once-generated recurring weekly pattern (see `weeklySessions`).
  schedule: Session[];
  // How many days before "now" this bot's account should read as created,
  // for backdating: see `ensureBots` in ./index.ts.
  createdOffsetDays: number;
}

// Levels cycle down the roster rather than sitting in blocks, so the first
// bots ever created are spread across all five instead of piling into one.
// Unchanged from the original fifteen-bot roster.
export function levelForIndex(i: number): BotLevel {
  return ((i % 5) + 1) as BotLevel;
}

function pick<T>(rng: Rng, list: T[]): T {
  return list[Math.floor(rng() * list.length) % list.length];
}

function weightedIndex(rng: Rng, weights: number[]): number {
  const total = weights.reduce((sum, w) => sum + w, 0);
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

/* Weekly-hours budget: a heavy tail. About 5% grinders (40-80h/week,
   4-12h sessions), about 25% regulars (8-20h/week, 1-3h sessions), the rest
   casual (1-5h/week, 20-60 minute sessions). */
function drawBudget(rng: Rng): WeeklyBudget {
  const r = rng();
  if (r < 0.05) {
    return { tier: 'grinder', hoursPerWeek: 40 + rng() * 40, sessionMinutes: [240, 720] };
  }
  if (r < 0.3) {
    return { tier: 'regular', hoursPerWeek: 8 + rng() * 12, sessionMinutes: [60, 180] };
  }
  return { tier: 'casual', hoursPerWeek: 1 + rng() * 4, sessionMinutes: [20, 60] };
}

/* Preferred hours of day, in the bot's own local time: an evening peak from
   19:00 to 23:30, a smaller lunchtime bump, and a low but nonzero floor the
   rest of the day. A minority are night owls instead, peaking from 23:00
   to 3:00. Not normalised to sum to 1: only relative weight matters, and
   `weeklySessions` divides by the total itself. */
function drawPreferredHours(rng: Rng): number[] {
  const nightOwl = rng() < 0.08;
  const hours = new Array(24).fill(0.15);
  if (nightOwl) {
    for (const h of [23, 0, 1, 2, 3]) hours[h] = 1.6;
    for (const h of [21, 22, 4]) hours[h] = 0.6;
  } else {
    for (const h of [19, 20, 21, 22]) hours[h] = 1.8;
    hours[23] = 1.1;
    hours[18] = 0.8;
    hours[12] = 0.9;
    hours[13] = 0.7;
  }
  // A little per-bot jitter so two bots with the same shape do not peak at
  // exactly the same minute of the day, on average.
  return hours.map((w) => Math.max(0.05, w * (0.85 + rng() * 0.3)));
}

/* Days of the week, weighted toward the weekend. 0 Sunday .. 6 Saturday. */
function drawPreferredDays(rng: Rng): number[] {
  const base = [1.3, 0.8, 0.8, 0.85, 0.9, 1.1, 1.4]; // Sun..Sat
  return base.map((w) => Math.max(0.1, w * (0.9 + rng() * 0.2)));
}

/* The bot's fixed recurring weekly schedule: sessions placed on days and at
   hours drawn from its own preferences, with durations drawn from its
   budget's session-length range, added until the week's total is as close
   to `hoursPerWeek` as the next session would make it. Pure and seeded, so
   the same bot always gets the same week. */
export function weeklySessions(bot: Pick<PopulationBot, 'budget' | 'preferredHours' | 'preferredDays'>, rng: Rng): Session[] {
  const targetMinutes = bot.budget.hoursPerWeek * 60;
  const [minLen, maxLen] = bot.budget.sessionMinutes;
  const sessions: Session[] = [];
  let total = 0;
  for (let guard = 0; guard < 500; guard++) {
    const duration = Math.round(minLen + rng() * (maxLen - minLen));
    const wouldBe = total + duration;
    // Stop once adding another session would overshoot the budget by more
    // than stopping short of it, so the week's total lands close to the
    // budget rather than reliably over it.
    if (total > 0 && Math.abs(total - targetMinutes) <= Math.abs(wouldBe - targetMinutes)) break;
    const day = weightedIndex(rng, bot.preferredDays);
    const hour = weightedIndex(rng, bot.preferredHours);
    const startMinute = hour * 60 + Math.floor(rng() * 60);
    sessions.push({ day, startMinute, durationMinutes: duration });
    total = wouldBe;
  }
  return sessions;
}

const MODES: Mode[] = ['six-max', 'six-max', 'six-max', 'heads-up']; // six-max is the site's main game
const SPEEDS: Speed[] = ['standard', 'standard', 'standard', 'fast', 'fast'];

const GREETINGS = ['hi all', 'gl everyone', 'evening', 'hey', 'gl all', 'hiya'];
const FAREWELLS = ['gg', 'gg wp', 'nh', 'well played', 'cheers, gg', 'ggwp'];

/* Chattiness by activity tier: the most active bots (grinders) are the ones
   who get most of the table talk, sent sparingly even for them. Most bots,
   regardless of tier, say nothing at all in a given match. */
function drawChat(rng: Rng, tier: ActivityTier): ChatProfile {
  const chattiness = tier === 'grinder' ? 0.3 : tier === 'regular' ? 0.08 : 0.02;
  return {
    chattiness,
    greeting: rng() < 0.6 ? pick(rng, GREETINGS) : null,
    farewell: rng() < 0.6 ? pick(rng, FAREWELLS) : null,
  };
}

const SEED = 'opentable-population';

/* The population, index 0 upward, generated once from a fixed seed. Growing
   `count` only appends: every earlier bot is drawn from the same point in
   the same rng sequence no matter how large `count` grows, which is what
   lets a bot's name, rating and history survive a bigger roster. */
export function generatePopulation(count: number, seed = SEED): PopulationBot[] {
  const rng = seededRng(seed);
  const seen = new Set<string>();
  const out: PopulationBot[] = [];
  for (let i = 0; i < count; i++) {
    let identity = generateRealisticIdentity(rng);
    while (seen.has(identity.name.toLowerCase())) identity = generateRealisticIdentity(rng);
    seen.add(identity.name.toLowerCase());

    const archetype = pick(rng, ARCHETYPES) as Archetype;
    const persona = jitteredPersona(archetype, rng);
    const budget = drawBudget(rng);
    const preferredHours = drawPreferredHours(rng);
    const preferredDays = drawPreferredDays(rng);
    const bot: PopulationBot = {
      index: i,
      name: identity.name,
      country: identity.country,
      timezone: timezoneFor(identity.country),
      level: levelForIndex(i),
      persona,
      budget,
      preferredHours,
      preferredDays,
      mode: pick(rng, MODES),
      speed: pick(rng, SPEEDS),
      chat: drawChat(rng, budget.tier),
      schedule: [],
      // Staggered over the previous 18 months, so profiles do not all read
      // "joined today". A grinder is more likely to be one of the site's
      // early accounts than a weekend tourist is, which is why this is
      // drawn after the budget rather than independently of it.
      createdOffsetDays: drawJoinOffset(rng, budget.tier),
    };
    bot.schedule = weeklySessions(bot, rng);
    out.push(bot);
  }
  return out;
}

function drawJoinOffset(rng: Rng, tier: ActivityTier): number {
  const maxDays = 18 * 30;
  const skew = tier === 'grinder' ? 1.6 : tier === 'regular' ? 1.2 : 0.9;
  return Math.round(maxDays * rng() ** (1 / skew));
}

// Whether `at`, read in `timezone`, falls inside one of `schedule`'s
// recurring windows. Exported alongside the roster because it is the other
// pure half of "is this bot online right now": generation lives here,
// population.ts's live tick is the only impure part.
export function isOnlineAt(schedule: Session[], timezone: string, at: Date): boolean {
  const { hour, minute, weekday } = localTimeAt(timezone, at);
  const minuteOfDay = hour * 60 + minute;
  for (const s of schedule) {
    if (s.day === weekday && minuteOfDay >= s.startMinute && minuteOfDay < s.startMinute + s.durationMinutes) {
      return true;
    }
    // A session starting late enough to run past midnight is also "on" for
    // the next calendar day, up to the point it ends.
    const wrap = s.startMinute + s.durationMinutes - 1440;
    if (wrap > 0 && (s.day + 1) % 7 === weekday && minuteOfDay < wrap) return true;
  }
  return false;
}
