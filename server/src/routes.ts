import type { FastifyInstance, FastifyRequest } from 'fastify';
import { blindsAt, type MatchFormat, type Mode } from '@opentable/protocol';
import { bucketFor, effectiveStackBb, handClass, spotFor, walkPreflop } from '@opentable/preflop';

function modeParam(raw: unknown): Mode {
  return MODES.includes(raw as Mode) ? (raw as Mode) : 'heads-up';
}
import {
  MODES,
  getLeaderboard,
  getModeStandings,
  getRatingsFor,
  getUserByNameLower,
  getUserHandStats,
  getUserPreflopAccuracy,
  getMatchesForUser,
  getInsightHandsForUser,
  getInsightMatchesForUser,
  getExplorerHands,
  getArenasForUser,
  getRatingHistoryForUser,
  getMatchById,
  getHandsForMatch,
  getHandById,
  getRecentMatches,
  getPuzzleHandCandidates,
  getLiveMatches,
  getSiteStats,
  deleteSession,
  getUserAvatar,
  setUserAvatar,
  clearUserAvatar,
  type MatchRow,
  type ModeStanding,
} from './db.js';
import { config } from './config.js';
import { hub } from './ws/hub.js';
import { queueSize } from './matchmaking.js';
import { getRoom } from './match/rooms.js';
import { claimGuest, login, requireUser, setSessionCookie, clearSessionCookie, createSessionForUser, SESSION_COOKIE } from './auth.js';
import { rosterSummary } from './bots/index.js';
import { mainMode, roundRatings, toModeRating, toUserSummary } from './userView.js';
import { computeInsights, type Insights } from './insights.js';
import { health } from './health.js';
import { emptyExplorerCube, explorerQuery, foldExplorerHands, sliceExplorer, type ExplorerCube } from './explorer.js';
import { acceptChallenge, cancelChallenge, challengeView, createChallenge } from './challenges.js';
import {
  cancelHomeGame,
  createHomeGame,
  homeGameView,
  joinHomeGame,
  leaveHomeGame,
  startHomeGame,
} from './home-games.js';
import { arenaListing, arenaView, joinArena, leaveArena, pauseArena } from './arena.js';
import { registerAdminRoutes } from './admin.js';
import { AVATAR_MAX_BYTES, AvatarLimiter, sniffAvatar } from './avatars.js';

function err(reply: { code: (n: number) => { send: (b: unknown) => unknown } }, status: number, message: string) {
  return reply.code(status).send({ error: message });
}

export function registerRoutes(app: FastifyInstance): void {
  // Always 200 while the process answers; what is actually healthy is in the
  // body. See health.ts for the contract.
  app.get('/health', async () => health());

  // The admin layer lives in its own file: every route in it is behind the
  // admin gate, and none of it is part of the game.
  registerAdminRoutes(app);

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
      // Only ever true for an admin. The key is absent for everybody else, so
      // nothing about the admin layer is on the wire for a player at all.
      ...(user.admin ? { admin: true } : {}),
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
    const standings = await getModeStandings(user.id);
    const history = await getRatingHistoryForUser(user.id);
    const stats = await getUserHandStats(user.id);
    const accuracy = await getUserPreflopAccuracy(user.id);
    const lastMatches = await getMatchesForUser(user.id, 20);
    // Arenas this player has finished, newest first. On the profile rather
    // than on a page of its own: an arena result is a thing you did, and the
    // place it belongs is beside the matches you played.
    const arenas = await getArenasForUser(user.id, 20);

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

    /* Where this player sits in each mode, keyed the way the standings are.
       A mode they have never played rated, and every mode of a bot, is null
       rather than a rank in a field they are not in. */
    const percentiles = {} as Record<Mode, ModeStanding | null>;
    for (const mode of MODES) percentiles[mode] = standings.find((s) => s.mode === mode) ?? null;

    return {
      summary: toUserSummary(user, ratings),
      // The mode the page opens on and puts in its headline.
      main: mainMode(ratings),
      percentiles,
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
      arenas,
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

  /* The opening explorer: what players here actually did preflop from a
     position, by hand class. One cube per mode holds every position, every
     situation and both player scopes, so the controls on the page cost a
     slice rather than a query.

     The cube is topped up rather than rebuilt. Every count in it is a sum, so
     the hands that finished since the last look can simply be added, and the
     site never pays to replay its whole history twice. Checked at most once a
     minute per mode, which is also what the Cache-Control tells the browser:
     a book of finished matches has nothing to say between one match and the
     next.

     That header is the one exception to app.ts's blanket `no-store` on /api,
     which is there because every other route is session-scoped. This one is
     not: it is the same public aggregate for everybody, logged in or not, and
     it moves only when a match finishes. The override is a route-level onSend
     because the blanket rule is an instance-level one and instance hooks run
     first. */
  app.get<{ Querystring: { mode?: string; position?: string; facing?: string; players?: string } }>(
    '/api/explorer',
    {
      onSend: async (_request, reply, payload) => {
        reply.header('Cache-Control', `public, max-age=${EXPLORER_REFRESH_MS / 1000}`);
        return payload;
      },
    },
    async (request) => {
      const mode = modeParam(request.query.mode);
      return sliceExplorer(await explorerCube(mode), explorerQuery(mode, request.query));
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

  /* One real preflop decision to be graded, from a finished heads-up hand.
     The walk is done here rather than in the client because @opentable/preflop
     reads its charts with node:fs and cannot be imported in a browser; the
     client is handed the spot it needs and replays the log to that point
     itself. A site with no such hand yet gets a 404 and a page that says so. */
  app.get('/api/puzzles/hand', async (_request, reply) => {
    for (const hand of await getPuzzleHandCandidates()) {
      const match = await getMatchById(hand.matchId);
      if (!match || match.seats.length !== 2 || !hand.holes || !hand.seed) continue;

      // Heads-up hands are stored in table seats and the two are the same
      // index space, which is what lets the row be walked as it stands.
      const config = { seats: hand.stacksStart.map((stack) => ({ stack })), button: hand.button, bb: blindsAt(match.format, hand.number).bb };
      const bucket = bucketFor(effectiveStackBb(config));
      const steps = walkPreflop(config, hand.actions);
      const graded = steps
        .map((step, index) => ({ step, index, spot: spotFor(bucket, step.position, step.raiseCount) }))
        .filter((g) => g.spot !== null && hand.holes?.[g.step.seat] !== undefined);
      if (graded.length === 0) continue;

      const chosen = graded[Math.floor(Math.random() * graded.length)];
      const hole = hand.holes[chosen.step.seat];
      const { sb, bb } = blindsAt(match.format, hand.number);
      return {
        handId: hand.id,
        matchId: hand.matchId,
        number: hand.number,
        seats: match.seats.map((s) => ({ seat: s.seat, name: s.name, bot: s.bot === true })),
        button: hand.button,
        sb,
        bb,
        stacksStart: hand.stacksStart,
        seed: hand.seed,
        actions: hand.actions,
        seat: chosen.step.seat,
        logIndex: chosen.index,
        position: chosen.step.position,
        bucket,
        spot: chosen.spot,
        effectiveBb: Math.round(effectiveStackBb(config) * 10) / 10,
        hand: handClass(hole),
        cards: hole,
        played: chosen.step.category,
      };
    }
    return err(reply, 404, 'no finished heads-up hand has a preflop decision to grade yet');
  });

  // Latest finished matches, newest first. Aborted matches are left out: they
  // changed nobody's rating and there is nothing to read in them. Ladder
  // matches (bots playing each other in the background) are left out too
  // unless `?ladder=1` asks for them: they are real rated matches, but there
  // are far more of them than there are matches a person played, and the feed
  // is for the second kind.
  app.get<{ Querystring: { limit?: string; ladder?: string } }>('/api/recent', async (request) => {
    const limit = clampLimit(request.query.limit, 20, 50);
    const rows = await getRecentMatches(limit, request.query.ladder === '1');
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

  // Matches in progress with a person at the table. The human queues never
  // seat a bot-only table, but the ladder does, and one of those is not
  // something to watch: the filter is what keeps it off the list.
  app.get('/api/live', async () => {
    const rows = await getLiveMatches();
    return rows.filter(hasHuman).map((m) => ({
      id: m.id,
      mode: m.format.mode,
      rated: m.rated,
      practice: isPractice(m.format),
      homeGame: m.format.homeGame === true,
      arena: m.format.arena ?? null,
      // handsPlayed counts completed hands, so the hand being dealt is the
      // next one along.
      hand: m.handsPlayed + 1,
      players: m.seats.map((s) => ({
        uid: s.userId,
        avatarV: s.avatarV ?? 0,
        name: s.name,
        bot: s.bot === true,
        rating: Math.round(s.rating),
      })),
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

  /* Home games: the six-max version of the same link. Every one of these goes
     through requireUser like a challenge does, so a link works for somebody who
     has never been here. The host starts the table; the match is created there
     and announced with the same `q found` everyone else's is. */
  app.post<{ Body: { rated?: boolean; botLevel?: number } }>('/api/home-games', async (request, reply) => {
    const user = await requireUser(request, reply);
    const result = await createHomeGame(user.id, request.body?.rated !== false, Number(request.body?.botLevel));
    if (!result.ok) return err(reply, result.status, result.error);
    return { id: result.row.id, url: `${originOf(request)}/g/${result.row.id}` };
  });

  app.get<{ Params: { id: string } }>('/api/home-games/:id', async (request, reply) => {
    const view = await homeGameView(request.params.id);
    if (!view) return err(reply, 404, 'no such table');
    return view;
  });

  app.post<{ Params: { id: string } }>('/api/home-games/:id/join', async (request, reply) => {
    const user = await requireUser(request, reply);
    const result = await joinHomeGame(request.params.id, user.id);
    if (!result.ok) return err(reply, result.status, result.error);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/home-games/:id/leave', async (request, reply) => {
    const user = await requireUser(request, reply);
    const result = await leaveHomeGame(request.params.id, user.id);
    if (!result.ok) return err(reply, result.status, result.error);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/home-games/:id/start', async (request, reply) => {
    const user = await requireUser(request, reply);
    const result = await startHomeGame(request.params.id, user.id);
    if (!result.ok) return err(reply, result.status, result.error);
    return { matchId: result.matchId, rated: result.rated, reason: result.reason };
  });

  app.delete<{ Params: { id: string } }>('/api/home-games/:id', async (request, reply) => {
    const user = await requireUser(request, reply);
    const result = await cancelHomeGame(request.params.id, user.id);
    if (!result.ok) return err(reply, result.status, result.error);
    return { ok: true };
  });

  /* Arenas. Every one of these goes through requireUser like a challenge does,
     so an arena is joinable by somebody who has never been here: they arrive,
     a guest is minted, and they are on the board. The listing stocks the
     schedule on its way past, so a database with no arenas in it answers the
     first request with one rather than with nothing. */
  app.get('/api/arenas', async (request, reply) => {
    const user = await requireUser(request, reply);
    return arenaListing(user.id);
  });

  app.get<{ Params: { id: string } }>('/api/arenas/:id', async (request, reply) => {
    const user = await requireUser(request, reply);
    const view = await arenaView(request.params.id, user.id);
    if (!view) return err(reply, 404, 'no such arena');
    return view;
  });

  app.post<{ Params: { id: string } }>('/api/arenas/:id/join', async (request, reply) => {
    const user = await requireUser(request, reply);
    const result = await joinArena(request.params.id, user.id);
    if (!result.ok) return err(reply, result.status, result.error);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/arenas/:id/leave', async (request, reply) => {
    const user = await requireUser(request, reply);
    const result = await leaveArena(request.params.id, user.id);
    if (!result.ok) return err(reply, result.status, result.error);
    return { ok: true };
  });

  /* Pause and resume are the same route: the page says which state it wants
     rather than asking for a toggle, so two tabs cannot flip each other. */
  app.post<{ Params: { id: string }; Body: { paused?: boolean } }>(
    '/api/arenas/:id/pause',
    async (request, reply) => {
      const user = await requireUser(request, reply);
      const result = await pauseArena(request.params.id, user.id, request.body?.paused !== false);
      if (!result.ok) return err(reply, result.status, result.error);
      return { ok: true };
    }
  );

  /* Profile pictures. Three routes: put one on, take it off, and serve one.

     The body is the image itself rather than a JSON envelope with base64 in
     it, which would cost a third more bytes for nothing. `bodyLimit` here is
     the route's own, well under Fastify's 1 MB default: a picture the client
     failed to shrink is refused by the framework before any of it is held.

     **The content type is not evidence.** It says what the caller claims, and
     what is actually served back to a browser later has to be what the bytes
     really are, so the magic number decides and the header only has to agree
     with it. A gif renamed to image/png dies here. */
  app.put(
    '/api/me/avatar',
    {
      bodyLimit: AVATAR_MAX_BYTES,
      errorHandler: (error, _request, reply) => {
        if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
          return err(reply, 413, `a picture must be under ${Math.floor(AVATAR_MAX_BYTES / 1024)} KB`);
        }
        return err(reply, error.statusCode && error.statusCode < 500 ? error.statusCode : 500, error.message);
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply);
      const declared = String(request.headers['content-type'] ?? '').split(';')[0].trim();
      if (declared !== 'image/webp' && declared !== 'image/png') {
        return err(reply, 415, 'a picture must be sent as image/webp or image/png');
      }
      const body = request.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        return err(reply, 400, 'the request body must be the image itself');
      }
      const sniffed = sniffAvatar(body);
      if (sniffed === null) return err(reply, 400, 'that file is not a png or a webp');
      if (sniffed !== declared) return err(reply, 400, `that file is a ${sniffed}, not a ${declared}`);
      if (!avatarLimiter.allow(user.id)) {
        return err(reply, 429, 'a picture can be changed once every ten seconds');
      }

      const version = await setUserAvatar(user.id, body, sniffed);
      if (version === null) return err(reply, 404, 'no such user');
      return { avatarV: version };
    }
  );

  /* Not rate limited, unlike the upload. The limiter is there to stop a script
     writing 128 KB into the users table on a loop; taking a picture off writes
     two nulls, and somebody who has just uploaded one and does not like it
     should not be told to wait ten seconds before they can undo it. */
  app.delete('/api/me/avatar', async (request, reply) => {
    const user = await requireUser(request, reply);
    const version = await clearUserAvatar(user.id);
    if (version === null) return err(reply, 404, 'no such user');
    return { avatarV: version };
  });

  /* The picture itself. `?v=` is the version the caller was told about, and a
     version is only ever handed out beside the bytes it belongs to, so a URL
     carrying one can be cached for good: a new picture is a different URL
     rather than a cache to invalidate. Without one the answer is still correct,
     just briefly cacheable, because "whatever this player looks like now" is a
     question whose answer moves.

     404 when there is no picture, which is not an error: it is what the client
     draws the generated avatar for, and it is the `onError` the <img> already
     has. */
  app.get<{ Params: { id: string }; Querystring: { v?: string } }>(
    '/api/avatars/:id',
    {
      onSend: async (request, reply, payload) => {
        const pinned = typeof (request.query as { v?: string }).v === 'string';
        reply.header('Cache-Control', pinned ? 'public, max-age=31536000, immutable' : 'public, max-age=60');
        return payload;
      },
    },
    async (request, reply) => {
      const row = await getUserAvatar(request.params.id);
      if (!row) return err(reply, 404, 'no picture');
      return reply.type(row.avatarType).send(row.avatar);
    }
  );
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

/* One per process, swept as it is asked. Not persisted on purpose: a restart
   letting somebody change their picture a second early is not worth a table. */
const avatarLimiter = new AvatarLimiter();

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

/* One cube per mode, kept for the life of the process and read up to a moving
   edge. Two entries at most, so unlike the insights cache there is nothing
   here to evict. A cold cube reads the most recent EXPLORER_HAND_LIMIT hands;
   every look after that adds only what finished since, which is why the limit
   bites once per restart rather than once per match. */
const EXPLORER_REFRESH_MS = 60_000;
const explorerCache = new Map<Mode, { cube: ExplorerCube; through: Date; checkedAt: number }>();

async function explorerCube(mode: Mode): Promise<ExplorerCube> {
  const now = Date.now();
  // Hands are only read up to a settled edge, so a row committed a moment
  // late cannot fall behind the window and be missed. See config.explorerLagMs.
  const before = new Date(now - config.explorerLagMs);
  const entry = explorerCache.get(mode);
  if (!entry) {
    const cube = emptyExplorerCube(mode);
    foldExplorerHands(cube, await getExplorerHands(mode, { before }));
    explorerCache.set(mode, { cube, through: before, checkedAt: now });
    return cube;
  }
  if (now - entry.checkedAt >= EXPLORER_REFRESH_MS) {
    foldExplorerHands(entry.cube, await getExplorerHands(mode, { before, after: entry.through }));
    entry.through = before;
    entry.checkedAt = now;
  }
  return entry.cube;
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
      uid: s.userId,
      // Stored with the seat, so a feed row shows the picture the player had
      // when they played rather than the one they have now.
      avatarV: s.avatarV ?? 0,
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
    homeGame: m.format.homeGame === true,
    arena: m.format.arena ?? null,
    handsPlayed: m.handsPlayed,
    finishedAt: m.finishedAt,
    players,
  };
}
