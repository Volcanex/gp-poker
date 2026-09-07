import type { FastifyInstance } from 'fastify';
import {
  sql,
  getLeaderboard,
  getUserByNameLower,
  getUserHandStats,
  getUserPreflopAccuracy,
  getMatchesForUser,
  getRatingHistoryForUser,
  getMatchById,
  getHandsForMatch,
  getHandById,
  deleteSession,
} from './db.js';
import { claimGuest, login, requireUser, setSessionCookie, clearSessionCookie, createSessionForUser, SESSION_COOKIE } from './auth.js';
import { isProvisional, roundRatings, toUserSummary } from './userView.js';

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
    return {
      ...toUserSummary(user),
      peak: Math.round(user.peakRating),
      matches: user.matches,
      wins: user.wins,
      losses: user.losses,
      draws: user.draws,
    };
  });

  app.post<{ Body: { name?: string; password?: string } }>('/api/claim', async (request, reply) => {
    const { name, password } = request.body ?? {};
    if (!name || !password) return err(reply, 400, 'name and password are required');
    const user = await requireUser(request, reply);
    const result = await claimGuest(user.id, name, password);
    if (!result.ok) return err(reply, 400, result.error);
    return toUserSummary(result.user);
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
    return toUserSummary(result.user);
  });

  app.post('/api/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await deleteSession(token);
    clearSessionCookie(request, reply);
    return { ok: true };
  });

  app.get('/api/leaderboard', async () => {
    const rows = await getLeaderboard(100);
    return rows.map((r) => ({
      name: r.name,
      rating: Math.round(r.rating),
      rd: Math.round(r.rd),
      matches: r.matches,
      peak: Math.round(r.peakRating),
    }));
  });

  app.get<{ Params: { name: string } }>('/api/users/:name', async (request, reply) => {
    const user = await getUserByNameLower(request.params.name.toLowerCase());
    if (!user) return err(reply, 404, 'no such user');

    const history = await getRatingHistoryForUser(user.id);
    const stats = await getUserHandStats(user.id);
    const accuracy = await getUserPreflopAccuracy(user.id);
    const lastMatches = await getMatchesForUser(user.id, 20);

    const totalOutcomes = user.wins + user.losses + user.draws;
    const winRate = totalOutcomes > 0 ? user.wins / totalOutcomes : 0;

    const vpip = stats.totalHands > 0 ? (stats.vpipHands / stats.totalHands) * 100 : 0;
    const pfr = stats.totalHands > 0 ? (stats.pfrHands / stats.totalHands) * 100 : 0;
    const aggressionFrequency =
      stats.aggrTotal + stats.passiveTotal > 0 ? stats.aggrTotal / (stats.aggrTotal + stats.passiveTotal) : 0;
    const foldTo3bet = stats.faced3betHands > 0 ? (stats.foldTo3betHands / stats.faced3betHands) * 100 : 0;

    return {
      summary: toUserSummary(user),
      peak: Math.round(user.peakRating),
      peakAt: user.peakAt,
      provisional: isProvisional(user),
      matches: user.matches,
      winRate,
      accuracy,
      ratingHistory: history.map((h) => ({ rating: Math.round(h.rating), rd: Math.round(h.rd), at: h.at, matchId: h.matchId })),
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
        accuracy: [h.study?.[0]?.summary.accuracy ?? null, h.study?.[1]?.summary.accuracy ?? null],
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
      button: hand.button,
      sb: match.format.sb,
      bb: match.format.bb,
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
}
