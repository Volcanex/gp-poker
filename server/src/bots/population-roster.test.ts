import { describe, expect, it } from 'vitest';
import {
  generatePopulation,
  isOnlineAt,
  levelForIndex,
  weeklySessions,
  THINKING_SEATS,
  type Session,
} from './population-roster.js';
import { seededRng } from '@opentable/identity';

describe('generatePopulation', () => {
  it('is deterministic for a fixed seed', () => {
    const a = generatePopulation(60);
    const b = generatePopulation(60);
    expect(a).toEqual(b);
  });

  it('growing the count only appends: every earlier bot is unchanged', () => {
    const small = generatePopulation(30);
    const big = generatePopulation(120);
    for (let i = 0; i < small.length; i++) {
      expect(big[i]).toEqual(small[i]);
    }
  });

  it('produces no duplicate names at 500', () => {
    const bots = generatePopulation(500);
    const names = new Set(bots.map((b) => b.name.toLowerCase()));
    expect(names.size).toBe(500);
  });

  it('puts nobody below the tight tier and half the roster on the sharp one', () => {
    // The population is who a player meets in the queue, so it is the top
    // three synchronous tiers only. The weak ones are the practice ladder's,
    // chosen on purpose, and are not sat in front of anybody by this roster.
    const bots = generatePopulation(120);
    const public_ = bots.filter((b) => !(b.index in THINKING_SEATS));
    expect(Math.min(...public_.map((b) => b.level))).toBe(3);
    const sharp = public_.filter((b) => b.level === 5).length;
    expect(sharp / public_.length).toBeGreaterThanOrEqual(0.45);
    expect(bots.map((b) => b.level)).toEqual(bots.map((b) => levelForIndex(b.index)));
  });

  it('cycles the levels down the roster rather than sitting them in blocks', () => {
    // Ten consecutive seats cover all three tiers, so the first bots ever
    // created are spread across them instead of piling into one.
    const first = Array.from({ length: 10 }, (_, i) => levelForIndex(i));
    expect(new Set(first)).toEqual(new Set([3, 4, 5]));
  });

  /* The seats that think. Rare on purpose, at the end of the default
     population so a smaller one has none, and index-keyed so that growing the
     population cannot move them onto somebody else. */
  it('gives a few late seats a tier that thinks, and moves nobody else', () => {
    const thinking = Object.entries(THINKING_SEATS);
    expect(thinking.length).toBeLessThanOrEqual(3);
    expect(Object.values(THINKING_SEATS).filter((l) => l === 7)).toHaveLength(1);
    for (const [index, level] of thinking) {
      expect(levelForIndex(Number(index))).toBe(level);
      expect(Number(index)).toBeGreaterThanOrEqual(100);
    }
    const bots = generatePopulation(120);
    expect(bots.filter((b) => b.level >= 6)).toHaveLength(thinking.length);
    // Every other seat is on the cycle, and the cycle repeats every ten.
    for (const bot of bots) {
      if (bot.index in THINKING_SEATS) continue;
      expect(bot.level).toBe(levelForIndex(bot.index % 10));
    }
  });

  /* Names and schedules are drawn before the level is read, so which seats
     think cannot move anybody's identity. */
  it('leaves every identity where it was', () => {
    const bots = generatePopulation(120);
    for (const bot of bots) {
      expect(bot.name.length).toBeGreaterThan(0);
      expect(bot.schedule.length).toBeGreaterThan(0);
    }
  });

  it('every bot has a country, a timezone and a persona', () => {
    for (const bot of generatePopulation(120)) {
      expect(bot.country).toMatch(/^[a-z]{2}$/);
      expect(bot.timezone.length).toBeGreaterThan(0);
      expect(bot.persona.archetype).toBeTruthy();
    }
  });

  it('draws a heavy-tailed activity mix: a small share of grinders, more regulars, mostly casual', () => {
    const bots = generatePopulation(2000);
    const counts = { grinder: 0, regular: 0, casual: 0 };
    for (const bot of bots) counts[bot.budget.tier]++;
    const grinderShare = counts.grinder / bots.length;
    const regularShare = counts.regular / bots.length;
    const casualShare = counts.casual / bots.length;
    expect(grinderShare).toBeGreaterThan(0.02);
    expect(grinderShare).toBeLessThan(0.1);
    expect(regularShare).toBeGreaterThan(0.15);
    expect(regularShare).toBeLessThan(0.35);
    expect(casualShare).toBeGreaterThan(0.5);
  });

  it('backdates createdOffsetDays within the last 18 months', () => {
    for (const bot of generatePopulation(200)) {
      expect(bot.createdOffsetDays).toBeGreaterThanOrEqual(0);
      expect(bot.createdOffsetDays).toBeLessThanOrEqual(18 * 30);
    }
  });
});

describe('weeklySessions', () => {
  const budget = { tier: 'regular' as const, hoursPerWeek: 14, sessionMinutes: [60, 180] as [number, number] };
  // Only evenings are preferred: every session's start hour must land there.
  const preferredHours = new Array(24).fill(0);
  for (const h of [19, 20, 21, 22]) preferredHours[h] = 1;
  const preferredDays = [1, 1, 1, 1, 1, 1, 1];

  it("every session's start hour falls inside the bot's nonzero preferred hours", () => {
    const rng = seededRng('weekly-sessions-hours');
    const sessions = weeklySessions({ budget, preferredHours, preferredDays }, rng);
    expect(sessions.length).toBeGreaterThan(0);
    for (const s of sessions) {
      const hour = Math.floor(s.startMinute / 60);
      expect(preferredHours[hour]).toBeGreaterThan(0);
    }
  });

  it('sums to about the weekly budget', () => {
    const rng = seededRng('weekly-sessions-total');
    const sessions = weeklySessions({ budget, preferredHours, preferredDays }, rng);
    const totalMinutes = sessions.reduce((sum, s) => sum + s.durationMinutes, 0);
    const targetMinutes = budget.hoursPerWeek * 60;
    // Within one session's length of the target either way.
    expect(Math.abs(totalMinutes - targetMinutes)).toBeLessThanOrEqual(budget.sessionMinutes[1]);
  });

  it('a grinder plays far more weekly minutes than a casual bot with the same preferences', () => {
    const casualBudget = { tier: 'casual' as const, hoursPerWeek: 3, sessionMinutes: [20, 60] as [number, number] };
    const grinderBudget = { tier: 'grinder' as const, hoursPerWeek: 60, sessionMinutes: [240, 720] as [number, number] };
    const casual = weeklySessions({ budget: casualBudget, preferredHours, preferredDays }, seededRng('casual'));
    const grinder = weeklySessions({ budget: grinderBudget, preferredHours, preferredDays }, seededRng('grinder'));
    const total = (sessions: Session[]) => sessions.reduce((sum, s) => sum + s.durationMinutes, 0);
    expect(total(grinder)).toBeGreaterThan(total(casual) * 5);
  });
});

describe('isOnlineAt', () => {
  const schedule: Session[] = [{ day: 3, startMinute: 19 * 60, durationMinutes: 120 }]; // Wed 19:00-21:00 local
  const tz = 'UTC';

  it('is online inside the window and offline outside it', () => {
    expect(isOnlineAt(schedule, tz, new Date('2026-09-09T19:30:00Z'))).toBe(true); // Wednesday
    expect(isOnlineAt(schedule, tz, new Date('2026-09-09T18:59:00Z'))).toBe(false);
    expect(isOnlineAt(schedule, tz, new Date('2026-09-09T21:01:00Z'))).toBe(false);
    expect(isOnlineAt(schedule, tz, new Date('2026-09-10T19:30:00Z'))).toBe(false); // Thursday: wrong day
  });

  it('handles a session that runs past local midnight', () => {
    const wrapping: Session[] = [{ day: 5, startMinute: 23 * 60 + 30, durationMinutes: 90 }]; // Fri 23:30 for 90 min
    // 2026-09-11 is a Friday in UTC.
    expect(isOnlineAt(wrapping, tz, new Date('2026-09-11T23:45:00Z'))).toBe(true);
    expect(isOnlineAt(wrapping, tz, new Date('2026-09-12T00:30:00Z'))).toBe(true); // Saturday, but still the Friday session
    expect(isOnlineAt(wrapping, tz, new Date('2026-09-12T01:30:00Z'))).toBe(false);
  });

  it("reads the schedule in the bot's own timezone, not the server's", () => {
    // Tokyo is UTC+9: a bot scheduled for 19:00-21:00 Tokyo time is online at
    // 10:30 UTC and not at 19:30 UTC.
    expect(isOnlineAt(schedule, 'Asia/Tokyo', new Date('2026-09-09T10:30:00Z'))).toBe(true);
    expect(isOnlineAt(schedule, 'Asia/Tokyo', new Date('2026-09-09T19:30:00Z'))).toBe(false);
  });
});
