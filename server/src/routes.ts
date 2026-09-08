import type { FastifyInstance, FastifyRequest } from 'fastify';
import { blindsAt, type MatchFormat, type Mode } from '@opentable/protocol';

function modeParam(raw: unknown): Mode {
  return MODES.includes(raw as Mode) ? (raw as Mode) : 'heads-up';
}
import {
  sql,
  MODES,
  getLeaderboard,
  getRatingsFor,
  getUserByNameLower,
  getUserHandStats,
  getUserPreflopAccuracy,
  getMatchesForUser,
  getInsightHandsForUser,
  getInsightMatchesForUser,
  getRatingHistoryForUser,
  getMatchById,
  getHandsForMatch,
  getHandById,
  getRecentMatches,
  getLiveMatches,
  getSiteStats,
  deleteSession,
  type MatchRow,
} from './db.js';
import { hub } from './ws/hub.js';
import { queueSize } from './matchmaking.js';
import { getRoom } from './match/rooms.js';
import { claimGuest, login, requireUser, setSessionCookie, clearSessionCookie, createSessionForUser, SESSION_COOKIE } from './auth.js';
import { rosterSummary } from './bots/index.js';
import { roundRatings, toModeRating, toUserSummary } from './userView.js';
import { computeInsights, type Insights } from './insights.js';
import { acceptChallenge, cancelChallenge, challengeView, createChallenge } from './challenges.js';

function err(reply: { code: (n: number) => { send: (b: unknown) => unknown } }, status: number, message: string) {
  return reply.code(status).send({ error: message });
}

export function registerRoutes(app: FastifyInstance): void {
  app.get('/health', async () => {
    try {
      await sql`select 1`;
      return { ok: true, checks: { db: { ok: true, detail: 'connected' } } };
    } catch (e) {
      return { ok: true, checks: { db: { ok: false, detail: String(e) } } };
    }
  });

  app.get('/api/me', async (request, reply) => {
    const user = await requireUser(request, reply);
    const summary = toUserSummary(user, await getRatingsFor(user.id));
    const headsUp = summary.ratings['heads-up'];
    // The flat peak/peakAt/matches/wins/losses/draws are the heads-up ones,
    // same compatibility bargain as the flat rating fields on UserSummary.
    // They are read straight off the heads-up standing rather than recomputed,
    // so a caller falling back from a null standing to the flat field can
    // never be handed a different answer than the standing already gave it.
    return {
      ...summary,
      peak: headsUp.peak,
      peakAt: headsUp.peakAt,
      matches: headsUp.matches,
      wins: headsUp.wins,
      losses: headsUp.losses,
      draws: headsUp.draws,
    };
  });

  app.post<{ Body: { name?: string; password?: string } }>('/api/claim', async (request, reply) => {
    const { name, password } = request.body ?? {};
    if (!name || !password) return err(reply, 400, 'name and password are required');
    const user = await requireUser(request, reply);
    const result = await claimGuest(user.id, name, password);
    if (!result.ok) return err(reply, 400, result.error);
    return toUserSummary(result.user, await getRatingsFor(result.user.id));
  });

  app.post<{ Body: { name?: string; password?: string } }>('/api/login', async (request, reply) => {
    const { name, password } = request.body ?? {};
    if (!name || !password) return err(reply, 400, 'name and password are required');
    const result = await login(name, password);
    if (!result.ok) return err(reply, 401, result.error);
    const existingToken = request.cookies[SESSION_COOKIE];
    if (existingToken) await deleteSession(existingToken);
    const { token } = await createSessionForUser(result.user.id);
    setSessionCookie(request, reply, token);
    return toUserSummary(result.user, await getRatingsFor(result.user.id));
  });

  app.post('/api/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await deleteSession(token);
    clearSessionCookie(request, reply);
    return { ok: true };
  });

  app.get<{ Querystring: { mode?: string } }>('/api/leaderboard', async (request) => {
    const mode = modeParam(request.query.mode);
    const rows = await getLeaderboard(mode, 100);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      rating: Math.round(r.rating),
      rd: Math.round(r.rd),
      matches: r.matches,
      peak: Math.round(r.peakRating),
    }));
  });

  /* The bot roster, for the practice picker: who plays at which level, what
     that level means, and how each one is actually doing in each mode. Bots
     stay off the leaderboard; this is the one place they are listed. */
  app.get('/api/bots', async () => {
    return rosterSummary();
  });

  app.get<{ Params: { name: string } }>('/api/users/:name', async (request, reply) => {
    const user = await getUserByNameLower(request.params.name.toLowerCase());
    if (!user) return err(reply, 404, 'no such user');

    const ratings = await getRatingsFor(user.id);
    const history = await getRatingHistoryForUser(user.id);
    const stats = await getUserHandStats(user.id);
    const accuracy = await getUserPreflopAccuracy(user.id);
    const lastMatches = await getMatchesForUser(user.id, 20);

    const headsUp = ratings['heads-up'];
    // The one heads-up standing every flat field on this route is read from,
    // so they cannot disagree with summary.ratings['heads-up'].
    const headsUpStanding = toModeRating(headsUp);
    const totalOutcomes = headsUp.wins + headsUp.losses + headsUp.draws;
    const winRate = totalOutcomes > 0 ? headsUp.wins / totalOutcomes : 0;

    // Rating history is per mode too: one line per mode, not one line with a
    // six-max result spliced into a heads-up curve.
    const ratingHistory = {} as Record<Mode, { rating: number; rd: number; at: Date; matchId: string | null }[]>;
    for (const mode of MODES) {
      ratingHistory[mode] = history
        .filter((h) => h.mode === mode)
        .map((h) => ({ rating: Math.round(h.rating), rd: Math.round(h.rd), at: h.at, matchId: h.matchId }));
    }

    const vpip = stats.totalHands > 0 ? (stats.vpipHands / stats.totalHands) * 100 : 0;
    const pfr = stats.totalHands > 0 ? (stats.pfrHands / stats.totalHands) * 100 : 0;
    const aggressionFrequency =
      stats.aggrTotal + stats.passiveTotal > 0 ? stats.aggrTotal / (stats.aggrTotal + stats.passiveTotal) : 0;
    const foldTo3bet = stats.faced3betHands > 0 ? (stats.foldTo3betHands / stats.faced3betHands) * 100 : 0;

    return {
      summary: toUserSummary(user, ratings),
      // Flat fields stay heads-up for compatibility; summary.ratings has the
      // per-mode standings including peak and the counters.
      peak: headsUpStanding.peak,
      peakAt: headsUpStanding.peakAt,
      provisional: headsUpStanding.provisional,
      matches: headsUpStanding.matches,
      winRate,
      accuracy,
      ratingHistory,
      stats: {
        hands: stats.totalHands,
        vpip,
        pfr,
        aggressionFrequency,
        foldTo3bet,
      },
      lastMatches,
    };
  });

  /* How somebody actually plays, derived from their stored hands rather than
     from a counter kept at write time. Cached per (user, mode) on the id of
     their latest finished match in that mode: nothing in here can move until
     another match of theirs ends, so the replay work happens once per match
     rather than once per visitor. The cheap query is the one that produces
     the key, so a cache hit costs a single lookup. */
  app.get<{ Params: { name: string }; Querystring: { mode?: string } }>(
    '/api/users/:name/insights',
    async (request, reply) => {
      const user = await getUserByNameLower(request.params.name.toLowerCase());
      if (!user) return err(reply, 404, 'no such user');
      const mode = modeParam(request.query.mode);

      const matches = await getInsightMatchesForUser(user.id, mode);
      const key = `${user.id}:${mode}`;
      const at = matches[0]?.id ?? 'none';
      const cached = insightsCache.get(key);
      if (cached && cached.at === at) return cached.body;

      const hands = await getInsightHandsForUser(user.id, mode);
      const body = computeInsights({ mode, hands, matches });
      rememberInsights(key, at, body);
      return body;
    }
  );

  app.get<{ Params: { id: string } }>('/api/matches/:id', async (request, reply) => {
    const match = await getMatchById(request.params.id);
    if (!match) return err(reply, 404, 'no such match');
    const hands = await getHandsForMatch(match.id);
    return {
      id: match.id,
      format: match.format,
      rated: match.rated,
      seats: match.seats,
      status: match.status,
      winner: match.winner,
      reason: match.reason,
      handsPlayed: match.handsPlayed,
      finalStacks: match.finalStacks,
      places: match.places,
      ratings: match.ratings ? roundRatings(match.ratings) : null,
      createdAt: match.createdAt,
      finishedAt: match.finishedAt,
      hands: hands.map((h) => ({
        number: h.number,
        completedAt: h.completedAt,
        seedHash: h.seedHash,
        seed: h.completedAt ? h.seed : null,
        board: h.board,
        stacks: h.stacksStart,
        awards: h.result?.awards ?? null,
        liveSeats: h.liveSeats,
        // One entry per table seat; null for a six-max hand, which stores no
        // preflop study at all.
        accuracy: match.seats.map((s) => h.study?.[s.seat]?.summary.accuracy ?? null),
      })),
    };
  });

  app.get<{ Params: { id: string } }>('/api/hands/:id', async (request, reply) => {
    const hand = await getHandById(request.params.id);
    if (!hand) return err(reply, 404, 'no such hand');
    const match = await getMatchById(hand.matchId);
    if (!match) return err(reply, 404, 'no such match');
    const completed = hand.completedAt !== null;
    return {
      id: hand.id,
      matchId: hand.matchId,
      number: hand.number,
      seats: match.seats,
      button: hand.button, // table seat
      liveSeats: hand.liveSeats, // engine-seat order; null on pre-v2 hands
      ...blindsAt(match.format, hand.number),
      stacksStart: hand.stacksStart,
      seedHash: hand.seedHash,
      seed: completed ? hand.seed : null,
      actions: hand.actions,
      board: hand.board,
      holes: completed ? hand.holes : null,
      result: completed ? hand.result : null,
      stats: hand.stats,
      study: hand.study,
      startedAt: hand.startedAt,
      completedAt: hand.completedAt,
    };
  });

  // Latest finished matches, newest first. Aborted matches are left out: they
  // changed nobody's rating and there is nothing to read in them.
  app.get<{ Querystring: { limit?: string } }>('/api/recent', async (request) => {
    const limit = clampLimit(request.query.limit, 20, 50);
    const rows = await getRecentMatches(limit);
    return rows.map(toFeedMatch);
  });

  // The home page's stats strip. Cached because it is polled every ten
  // seconds by every open tab and none of these numbers is worth a round trip
  // per viewer.
  app.get('/api/stats', async () => {
    const now = Date.now();
    if (statsCache && now - statsCache.at < STATS_TTL_MS) return statsCache.body;
    const counts = await getSiteStats();
    const live = await getLiveMatches();
    const body = {
      online: hub.countHumans(),
      inQueue: queueSize(),
      playing: live.filter(hasHuman).length,
      matchesToday: counts.matchesToday,
      handsTotal: counts.handsTotal,
      playersTotal: { registered: counts.playersRegistered, guest: counts.playersGuest },
    };
    statsCache = { at: now, body };
    return body;
  });

  // Matches in progress with a person at the table. Bot-only tables never
  // happen (matchmaking will not seat one), but the filter says so anyway.
  app.get('/api/live', async () => {
    const rows = await getLiveMatches();
    return rows.filter(hasHuman).map((m) => ({
      id: m.id,
      mode: m.format.mode,
      rated: m.rated,
      practice: isPractice(m.format),
      // handsPlayed counts completed hands, so the hand being dealt is the
      // next one along.
      hand: m.handsPlayed + 1,
      players: m.seats.map((s) => ({ name: s.name, bot: s.bot === true, rating: Math.round(s.rating) })),
      // People watching without a seat. Reported here and nowhere near the
      // table itself: the players are deciding and do not need the number.
      // A room that has already been unregistered reads as nobody watching
      // rather than as an absent field.
      spectators: getRoom(m.id)?.spectatorCount ?? 0,
      startedAt: m.createdAt,
    }));
  });

  /* Play a friend. Creating and accepting both go through requireUser, so a
     link works for someone who has never been here: they arrive, a guest is
     minted, and they are at the table. The match is created by the accept,
     which tells both players through the same `q found` a queue match sends. */
  app.post<{ Body: { mode?: string; rated?: boolean } }>('/api/challenges', async (request, reply) => {
    const user = await requireUser(request, reply);
    const result = await createChallenge(user.id, modeParam(request.body?.mode), request.body?.rated !== false);
    if (!result.ok) return err(reply, result.status, result.error);
    return { id: result.row.id, url: `${originOf(request)}/c/${result.row.id}` };
  });

  app.get<{ Params: { id: string } }>('/api/challenges/:id', async (request, reply) => {
    const view = await challengeView(request.params.id);
    if (!view) return err(reply, 404, 'no such challenge');
    return view;
  });

  app.post<{ Params: { id: string } }>('/api/challenges/:id/accept', async (request, reply) => {
    const user = await requireUser(request, reply);
    const result = await acceptChallenge(request.params.id, user.id);
    if (!result.ok) return err(reply, result.status, result.error);
    return { matchId: result.matchId };
  });

  app.delete<{ Params: { id: string } }>('/api/challenges/:id', async (request, reply) => {
    const user = await requireUser(request, reply);
    const result = await cancelChallenge(request.params.id, user.id);
    if (!result.ok) return err(reply, result.status, result.error);
    return { ok: true };
  });
}

/* The absolute address of this site as the caller reached it, which is the
   only thing a shareable link can be built from: nginx terminates TLS, so
   Fastify's own view of the protocol is http on every request that matters.
   Read the same way auth.ts reads it for the session cookie's secure flag. */
function originOf(request: FastifyRequest): string {
  const forwardedProto = request.headers['x-forwarded-proto'];
  const forwardedHost = request.headers['x-forwarded-host'];
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const proto = first(forwardedProto)?.split(',')[0]?.trim() || request.protocol;
  const host = first(forwardedHost)?.split(',')[0]?.trim() || request.headers.host;
  return `${proto}://${host}`;
}

const STATS_TTL_MS = 5_000;
let statsCache: { at: number; body: unknown } | null = null;

/* One entry per (user, mode), keyed on the match that last moved the answer.
   Bounded by insertion order rather than by use: the entries worth keeping
   are the ones being rebuilt, and a map that never forgets is a leak in a
   process that runs for weeks. */
const INSIGHTS_CACHE_MAX = 200;
const insightsCache = new Map<string, { at: string; body: Insights }>();

function rememberInsights(key: string, at: string, body: Insights): void {
  insightsCache.delete(key);
  insightsCache.set(key, { at, body });
  while (insightsCache.size > INSIGHTS_CACHE_MAX) {
    const oldest = insightsCache.keys().next().value;
    if (oldest === undefined) break;
    insightsCache.delete(oldest);
  }
}

function clampLimit(raw: string | undefined, fallback: number, max: number): number {
  const n = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

// Practice matches are never rated and are marked on their format. The field
// is optional on MatchFormat, so a match stored before practice existed reads
// as false rather than undefined.
function isPractice(format: MatchFormat): boolean {
  return format.practice === true;
}

function hasHuman(m: MatchRow): boolean {
  return m.seats.some((s) => s.bot !== true);
}

// Finishing order, not seat order: a feed row reads "winner beat loser", and
// seat 0 is nobody's idea of first. Seats with no place (a match stored
// before places existed) keep their seat order at the end.
function toFeedMatch(m: MatchRow) {
  const players = m.seats.map((s) => {
    const change = m.ratings?.[s.userId];
    return {
      name: s.name,
      bot: s.bot === true,
      place: m.places?.[s.userId] ?? null,
      ratingBefore: change ? Math.round(change.before) : null,
      ratingAfter: change ? Math.round(change.after) : null,
    };
  });
  players.sort((a, b) => (a.place ?? Infinity) - (b.place ?? Infinity));
  return {
    id: m.id,
    mode: m.format.mode,
    rated: m.rated,
    practice: isPractice(m.format),
    handsPlayed: m.handsPlayed,
    finishedAt: m.finishedAt,
    players,
  };
}
