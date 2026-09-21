import type { FastifyInstance, FastifyRequest } from 'fastify';
import { walkoutStrikesNow, type MatchFormat, type Mode } from '@opentable/protocol';
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
  getTournamentsForUser,
  getTournamentRecord,
  getRatingHistoryForUser,
  getMatchById,
  getHandsForMatch,
  getHandRowsForMatch,
  getHandById,
  getRecentMatches,
  getPuzzleHandCandidates,
  getLiveMatches,
  getSiteStats,
  deleteSession,
  getUserAvatar,
  handBlinds,
  setUserAvatar,
  clearUserAvatar,
  updateUserCountry,
  type MatchRow,
  type ModeStanding,
  type RatingRow,
  type UserRow,
} from './db.js';
import { readCountry } from './countries.js';
import { config, shownAsBot } from './config.js';
import { hub } from './ws/hub.js';
import { queueSize } from './matchmaking.js';
import { getRoom, roomForPlayer } from './match/rooms.js';
import { claimGuest, login, renameUser, requireUser, setSessionCookie, clearSessionCookie, createSessionForUser, SESSION_COOKIE } from './auth.js';
import { rosterSummary } from './bots/index.js';
import { onlineCount as populationOnlineCount } from './bots/population.js';
import { mainMode, roundRatings, toModeRating, toUserSummary } from './userView.js';
import { computeInsights, type Insights } from './insights.js';
import { computeMatchReview, type MatchReview } from './match-review.js';
import { health } from './health.js';
import { emptyExplorerCube, explorerQuery, foldExplorerHands, sliceExplorer, type ExplorerCube } from './explorer.js';
import { acceptChallenge, cancelChallenge, challengeSpeed, challengeView, createChallenge } from './challenges.js';
import {
  cancelHomeGame,
  createHomeGame,
  homeGameView,
  joinHomeGame,
  leaveHomeGame,
  startHomeGame,
} from './home-games.js';
import { arenaListing, arenaView, joinArena, leaveArena, pauseArena } from './arena.js';
import {
  acceptFriend,
  friendsView,
  inviteFriend,
  playedWith,
  removeFriend,
  requestFriendByName,
} from './friends.js';
import {
  registerForTournament,
  tournamentListing,
  tournamentView,
  withdrawFromTournament,
} from './tournaments/index.js';
import { registerGadminRoutes } from './gadmin.js';
import { googleConfigured, registerGoogleRoutes } from './google.js';
import { AVATAR_MAX_BYTES, AvatarLimiter, sniffAvatar } from './avatars.js';

function err(reply: { code: (n: number) => { send: (b: unknown) => unknown } }, status: number, message: string) {
  return reply.code(status).send({ error: message });
}

export function registerRoutes(app: FastifyInstance): void {
  // Always 200 while the process answers; what is actually healthy is in the
  // body. See health.ts for the contract.
  app.get('/health', async () => health());

  // The g-admin overlay's ticket API lives in its own file: every route in
  // it is behind the admin gate (cookie or X-Gadmin-Token), and none of it
  // is part of the game. See agents/g-admin-contract.md at the repo root.
  registerGadminRoutes(app);

  /* Google sign-in. Two browser navigations rather than anything under /api:
     the flow's whole point is that the browser goes to Google's own page and
     comes back, which an XHR cannot do. `google.ts` holds all of it. */
  registerGoogleRoutes(app);

  app.get('/api/me', async (request, reply) => {
    const user = await requireUser(request, reply);
    return meBody(user, await getRatingsFor(user.id));
  });

  /* The one thing a player can change about themselves without claiming an
     account: the flag beside their name. Guests may set it too, because a
     guest plays here like anybody else and the flag belongs to the seat. The
     body says the state it wants rather than asking for a toggle, so `null`
     clears the flag and two tabs cannot flip each other. An unknown code is
     refused rather than stored and then quietly never drawn. */
  app.patch<{ Body: { country?: unknown } }>('/api/me', async (request, reply) => {
    const user = await requireUser(request, reply);
    const country = readCountry(request.body?.country);
    if (country === undefined) return err(reply, 400, 'Country must be a two-letter country code, or null');
    const updated = await updateUserCountry(user.id, country);
    if (!updated) return err(reply, 404, 'No such user');
    return meBody(updated, await getRatingsFor(updated.id));
  });

  app.post<{ Body: { name?: string; password?: string } }>('/api/claim', async (request, reply) => {
    const { name, password } = request.body ?? {};
    if (!name || !password) return err(reply, 400, 'Name and password are required');
    const user = await requireUser(request, reply);
    const result = await claimGuest(user.id, name, password);
    if (!result.ok) return err(reply, 400, result.error);
    return toUserSummary(result.user, await getRatingsFor(result.user.id));
  });

  /* Changing the name on the account, guest or claimed alike: claiming picks
     a name once, this is the same field afterwards. `/u/:name` and every
     seat this player is dealt into from here on reads the new one; a match
     already finished keeps the name it was played under, in `matches.seats`,
     because a hand history is a record of what happened and not a live view
     of who's playing. */
  app.post<{ Body: { name?: string } }>('/api/rename', async (request, reply) => {
    const { name } = request.body ?? {};
    if (!name) return err(reply, 400, 'Name is required');
    const user = await requireUser(request, reply);
    const result = await renameUser(user.id, user.name, name);
    if (!result.ok) return err(reply, 400, result.error);
    return toUserSummary(result.user, await getRatingsFor(result.user.id));
  });

  app.post<{ Body: { name?: string; password?: string } }>('/api/login', async (request, reply) => {
    const { name, password } = request.body ?? {};
    if (!name || !password) return err(reply, 400, 'Name and password are required');
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
    const rows = await getLeaderboard(mode, 100, config.populationPublic);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      rating: Math.round(r.rating),
      rd: Math.round(r.rd),
      matches: r.matches,
      wins: r.wins,
      peak: Math.round(r.peakRating),
      country: r.country,
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
    if (!user) return err(reply, 404, 'No such user');

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
    /* And the tournaments, for the same reason. `record` is the headline
       tile's two numbers, counted over the whole career rather than over the
       capped list beside it. */
    const tournaments = await getTournamentsForUser(user.id, 20);
    const tournamentRecord = await getTournamentRecord(user.id);

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
      tournaments,
      tournamentRecord,
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
      if (!user) return err(reply, 404, 'No such user');
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
    if (!match) return err(reply, 404, 'No such match');
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

  /* The match-level review: how every seat at one finished match actually
     played, in it rather than across their whole history. Cached forever per
     match id, bounded the way the insights cache is: a finished match's hands
     never change, so there is no invalidation to key on, only a cap on how
     many reviews a long-running process keeps warm. Refused before the match
     is finished — a live table's hands are still arriving, and a review of a
     match mid-hand would be a review of a match that has not happened yet. */
  app.get<{ Params: { id: string } }>('/api/matches/:id/review', async (request, reply) => {
    const match = await getMatchById(request.params.id);
    if (!match) return err(reply, 404, 'No such match');
    if (match.status !== 'finished') return err(reply, 409, 'This match has not finished yet');
    const cached = matchReviewCache.get(match.id);
    if (cached) return cached;
    const hands = await getHandRowsForMatch(match.id);
    const review = computeMatchReview(match, hands);
    rememberMatchReview(match.id, review);
    return review;
  });

  app.get<{ Params: { id: string } }>('/api/hands/:id', async (request, reply) => {
    const hand = await getHandById(request.params.id);
    if (!hand) return err(reply, 404, 'No such hand');
    const match = await getMatchById(hand.matchId);
    if (!match) return err(reply, 404, 'No such match');
    const completed = hand.completedAt !== null;
    return {
      id: hand.id,
      matchId: hand.matchId,
      number: hand.number,
      seats: match.seats,
      button: hand.button, // table seat
      liveSeats: hand.liveSeats, // engine-seat order; null on pre-v2 hands
      ...handBlinds(hand, match.format),
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
      const config = { seats: hand.stacksStart.map((stack) => ({ stack })), button: hand.button, bb: handBlinds(hand, match.format).bb };
      const bucket = bucketFor(effectiveStackBb(config));
      const steps = walkPreflop(config, hand.actions);
      const graded = steps
        .map((step, index) => ({ step, index, spot: spotFor(bucket, step.position, step.raiseCount) }))
        .filter((g) => g.spot !== null && hand.holes?.[g.step.seat] !== undefined);
      if (graded.length === 0) continue;

      const chosen = graded[Math.floor(Math.random() * graded.length)];
      const hole = hand.holes[chosen.step.seat];
      const { sb, bb } = handBlinds(hand, match.format);
      return {
        handId: hand.id,
        matchId: hand.matchId,
        number: hand.number,
        seats: match.seats.map((s) => ({ seat: s.seat, name: s.name, bot: shownAsBot(s.bot, match.format.practice === true) })),
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
    return err(reply, 404, 'No finished heads-up hand has a preflop decision to grade yet');
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
    // The ladder query flag above already keeps ladder matches out unless
    // asked for, and a match that clears that flag is never re-hidden here:
    // `?ladder=1` is its own opt-in, independent of the population's. Every
    // other bot-only match needs the population's own gate, off by default
    // meaning "exactly the feed this site always had".
    return rows.filter((m) => m.format.ladder === true || config.populationPublic || hasHuman(m)).map(toFeedMatch);
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
      online: hub.countHumans() + (config.populationPublic ? populationOnlineCount() : 0),
      inQueue: queueSize(),
      playing: live.filter(isVisibleLive).length,
      matchesToday: counts.matchesToday,
      handsTotal: counts.handsTotal,
      playersTotal: { registered: counts.playersRegistered, guest: counts.playersGuest },
    };
    statsCache = { at: now, body };
    return body;
  });

  // Matches in progress worth watching. Off, this is exactly what it always
  // was: a person has to be at the table. On, the population's own matches
  // count too, because that is the whole point of turning it on; the ladder
  // stays off the list either way; it exists to make numbers real, not to be
  // watched.
  app.get('/api/live', async () => {
    const rows = await getLiveMatches();
    return rows.filter(isVisibleLive).map((m) => ({
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
        bot: shownAsBot(s.bot, isPractice(m.format)),
        rating: Math.round(s.rating),
        country: s.country ?? null,
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
  app.post<{ Body: { mode?: string; rated?: boolean; speed?: unknown } }>('/api/challenges', async (request, reply) => {
    const user = await requireUser(request, reply);
    const result = await createChallenge(
      user.id,
      modeParam(request.body?.mode),
      request.body?.rated !== false,
      challengeSpeed(request.body?.speed)
    );
    if (!result.ok) return err(reply, result.status, result.error);
    return { id: result.row.id, url: `${originOf(request)}/c/${result.row.id}` };
  });

  app.get<{ Params: { id: string } }>('/api/challenges/:id', async (request, reply) => {
    const view = await challengeView(request.params.id);
    if (!view) return err(reply, 404, 'No such challenge');
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
    if (!view) return err(reply, 404, 'No such table');
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

  /* Friends. Unlike every other door on this site these are not open to a
     guest: a guest's name is generated and its row may never be seen again,
     so a friendship with one is a friendship with nobody. `requireUser` still
     mints, because it is what puts a session on the request at all, and
     `friends.ts` is where the refusal is made, in one place and with one
     sentence, rather than at five route handlers.

     Every mutation pushes a `friend` message to both parties and answers with
     nothing but ok: the page asks for the list again, which is the answer it
     opened with, so there is never a second shape of it to keep in step. */
  app.get('/api/friends', async (request, reply) => {
    const user = await requireUser(request, reply);
    return friendsView(user.id, originOf(request));
  });

  /* Where friends actually come from on a poker site: the people you have
     sat down with. Its own route rather than a field on the list above,
     because it is a query over every match this player has been in and the
     friends page is the one screen that asks for it. */
  app.get('/api/friends/played', async (request, reply) => {
    const user = await requireUser(request, reply);
    return playedWith(user.id);
  });

  /* By name, because a name is what somebody has: one read off a seat, a
     profile or a result. An ask to somebody who has already asked you is the
     accept, which the answer says (`state`) so the page can draw the right
     thing without asking again. */
  app.post<{ Body: { name?: unknown } }>('/api/friends/request', async (request, reply) => {
    const user = await requireUser(request, reply);
    const result = await requestFriendByName(user.id, request.body?.name);
    if (!result.ok) return err(reply, result.status, result.error);
    return { ok: true, state: result.state };
  });

  app.post<{ Params: { userId: string } }>('/api/friends/:userId/accept', async (request, reply) => {
    const user = await requireUser(request, reply);
    const result = await acceptFriend(user.id, request.params.userId);
    if (!result.ok) return err(reply, result.status, result.error);
    return { ok: true, state: result.state };
  });

  /* One route for three things, because the row is what says which: a pending
     request you sent is a cancel, a pending one you were sent is a decline,
     and an accepted one is an unfriend. Nothing about the answer differs, so
     nothing about the request does either. */
  app.delete<{ Params: { userId: string } }>('/api/friends/:userId', async (request, reply) => {
    const user = await requireUser(request, reply);
    const result = await removeFriend(user.id, request.params.userId);
    if (!result.ok) return err(reply, result.status, result.error);
    return { ok: true };
  });

  /* Play with a friend. The link is made by the code that owns links, so the
     format, the caps, the expiry and the accept flow are the ones this site
     already had; this route adds a row saying who the link is for and a push
     telling them, which is the whole of "invite" as a feature. */
  app.post<{
    Params: { userId: string };
    Body: { kind?: unknown; mode?: unknown; rated?: unknown; speed?: unknown; botLevel?: unknown };
  }>('/api/friends/:userId/invite', async (request, reply) => {
    const user = await requireUser(request, reply);
    const result = await inviteFriend(user.id, request.params.userId, request.body ?? { kind: 'challenge' }, originOf(request));
    if (!result.ok) return err(reply, result.status, result.error);
    return { kind: result.kind, id: result.id, url: result.url };
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
    if (!view) return err(reply, 404, 'No such arena');
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
  /* Tournaments. The listing stocks the calendar on the server's way past, so
     the first call of the day is what creates the fixtures it answers with,
     exactly as the arena listing does. `page` walks the results under it.
     Registering and withdrawing both work for a guest, like every other way
     to play here. */
  app.get<{ Querystring: { page?: string } }>('/api/tournaments', async (request, reply) => {
    const user = await requireUser(request, reply);
    const page = Math.max(0, Math.min(200, Number(request.query.page ?? 0) || 0));
    return tournamentListing(user.id, page);
  });

  app.get<{ Params: { id: string } }>('/api/tournaments/:id', async (request, reply) => {
    const user = await requireUser(request, reply);
    const view = await tournamentView(request.params.id, user.id);
    if (!view) return err(reply, 404, 'No such tournament');
    return view;
  });

  app.post<{ Params: { id: string } }>('/api/tournaments/:id/register', async (request, reply) => {
    const user = await requireUser(request, reply);
    const result = await registerForTournament(request.params.id, user.id);
    if (!result.ok) return err(reply, result.status, result.error);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/tournaments/:id/withdraw', async (request, reply) => {
    const user = await requireUser(request, reply);
    const result = await withdrawFromTournament(request.params.id, user.id);
    if (!result.ok) return err(reply, result.status, result.error);
    return { ok: true };
  });

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
          return err(reply, 413, `A picture must be under ${Math.floor(AVATAR_MAX_BYTES / 1024)} KB`);
        }
        return err(reply, error.statusCode && error.statusCode < 500 ? error.statusCode : 500, error.message);
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply);
      const declared = String(request.headers['content-type'] ?? '').split(';')[0].trim();
      if (declared !== 'image/webp' && declared !== 'image/png') {
        return err(reply, 415, 'A picture must be sent as image/webp or image/png');
      }
      const body = request.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        return err(reply, 400, 'The request body must be the image itself');
      }
      const sniffed = sniffAvatar(body);
      if (sniffed === null) return err(reply, 400, 'That file is not a png or a webp');
      if (sniffed !== declared) return err(reply, 400, `That file is a ${sniffed}, not a ${declared}`);
      if (!avatarLimiter.allow(user.id)) {
        return err(reply, 429, 'A picture can be changed once every ten seconds');
      }

      const version = await setUserAvatar(user.id, body, sniffed);
      if (version === null) return err(reply, 404, 'No such user');
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
    if (version === null) return err(reply, 404, 'No such user');
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
      // A mock table asks for pictures by made-up ids; Postgres would reject
      // the cast with a 500, and no picture is a 404 whatever the id is.
      if (!UUID_RE.test(request.params.id)) return err(reply, 404, 'No picture');
      const row = await getUserAvatar(request.params.id);
      if (!row) return err(reply, 404, 'No picture');
      return reply.type(row.avatarType).send(row.avatar);
    }
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* What /api/me answers, from the GET and from a PATCH alike, so the two can
   never disagree about a field one of them forgot. The flat peak, peakAt,
   matches, wins, losses and draws are the heads-up ones, the same
   compatibility bargain as the flat rating fields on UserSummary, and every
   one is read straight off the heads-up standing rather than recomputed
   beside it. */
function meBody(user: UserRow, ratings: Record<Mode, RatingRow>) {
  const summary = toUserSummary(user, ratings);
  const headsUp = summary.ratings['heads-up'];
  const banNow = Date.now();
  const banUntil = user.rankedBanUntil?.getTime() ?? null;
  // The flat peak/peakAt/matches/wins/losses/draws are the heads-up ones,
  // same compatibility bargain as the flat rating fields on UserSummary.
  return {
    ...summary,
    // Only ever true for an admin. The key is absent for everybody else, so
    // nothing about the admin layer is on the wire for a player at all.
    ...(user.admin ? { admin: true } : {}),
    /* Whether this box can offer the Google button at all: it needs both
       halves of a credential, and a button that fails at Google is worse
       than no button. The key is absent when it cannot, the way `admin` is,
       so a client with no Google support and a server with no credentials
       agree without either knowing about the other. */
    ...(googleConfigured() ? { googleAuth: true } : {}),
    /* The walkout state, read straight off the row rather than queried for:
       the decay is arithmetic on two columns this payload already has.
       `rankedBanUntil` is epoch ms and not an ISO string, like every other
       deadline the client counts down (`ReadyCheck.deadline`, the queue
       cooldown), because that is what it is for. Null while there is no ban
       running, including one that has already expired. */
    walkoutStrikes: walkoutStrikesNow(user.walkoutStrikes, user.walkoutAt?.getTime() ?? null, banNow),
    rankedBanUntil: banUntil !== null && banUntil > banNow ? banUntil : null,
    /* The match this player is seated at right now, or null. The socket is
       how a player is told their table has started, and a phone drops the
       socket the moment its owner switches to a messaging app to send a
       challenge link: the `q found` for the match their friend then opened
       is pushed to nobody. This is the answer that survives the gap, read
       off the live rooms rather than a query, and the client refreshes it on
       every reconnect. A finished room lingers a minute before it is
       unregistered, so it is asked whether it is still active. */
    playing: playingNow(user.id),
    peak: headsUp.peak,
    peakAt: headsUp.peakAt,
    matches: headsUp.matches,
    wins: headsUp.wins,
    losses: headsUp.losses,
    draws: headsUp.draws,
  };
}

function playingNow(userId: string): string | null {
  const room = roomForPlayer(userId);
  return room?.active ? room.id : null;
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

// One entry per finished match, never invalidated: unlike the insights cache
// above there is no "at" to compare, because a finished match's hands cannot
// change under it. Bounded the same way, on insertion order, so a process
// that reviews a lot of old matches does not hold every one of them forever.
const MATCH_REVIEW_CACHE_MAX = 300;
const matchReviewCache = new Map<string, MatchReview>();

function rememberMatchReview(matchId: string, review: MatchReview): void {
  matchReviewCache.set(matchId, review);
  while (matchReviewCache.size > MATCH_REVIEW_CACHE_MAX) {
    const oldest = matchReviewCache.keys().next().value;
    if (oldest === undefined) break;
    matchReviewCache.delete(oldest);
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

// A match worth showing on /api/live and counting toward /api/stats'
// `playing`: a person at the table always qualifies; a bot-only table
// qualifies only when the population is public, and never if it is the
// ladder (`format.ladder`), which stays backstage regardless: it exists to
// make ratings real, not to be watched.
function isVisibleLive(m: MatchRow): boolean {
  if (m.format.ladder === true) return false;
  return hasHuman(m) || config.populationPublic;
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
      bot: shownAsBot(s.bot, isPractice(m.format)),
      // The seat's own snapshot, not the player's flag today: a feed row says
      // what the table looked like, the same way it says what they were rated.
      country: s.country ?? null,
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
