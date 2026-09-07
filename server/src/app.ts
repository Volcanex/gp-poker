import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { abortStalePlayingMatches, applySchema, getRatingsFor } from './db.js';
import { registerRoutes } from './routes.js';
import { resolveSessionUser } from './auth.js';
import { attachConnection } from './ws/hub.js';
import { routeClientMessage, routeConnect, routeDisconnect } from './ws/router.js';
import { ensureBots, setBotDispatch } from './bots/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(here, '..', '..', 'client', 'dist');

// Builds the Fastify instance without listening or starting matchmaking's
// tick, so tests can exercise it with app.inject()/app.injectWS() and
// control the matchmaking loop themselves.
export async function buildApp(): Promise<FastifyInstance> {
  await applySchema();
  // There is no way to safely resume live in-memory hand state across a
  // restart, so a match still 'playing' from last time is dead, not paused.
  await abortStalePlayingMatches();
  // Bots act through the ordinary client router; wiring it here keeps the
  // bot module from importing the websocket layer that imports matchmaking.
  setBotDispatch(routeClientMessage);
  await ensureBots();

  const app = Fastify({ logger: { level: config.logLevel } });

  await app.register(cookie);
  await app.register(websocket);
  await app.register(fastifyStatic, {
    root: clientDist,
    wildcard: false,
    setHeaders(reply, filePath) {
      const isHashedAsset = filePath.includes(`${path.sep}assets${path.sep}`);
      reply.header('Cache-Control', isHashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });

  // Every /api response is session-scoped and changes the moment a match
  // ends, so none of it may sit in a browser or proxy cache. Without this
  // there are no cache headers at all and a client refetching /api/me right
  // after `end` can be handed its own pre-match copy by heuristic freshness.
  app.addHook('onSend', async (request, reply, payload) => {
    if (request.raw.url?.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    return payload;
  });

  registerRoutes(app);

  app.get(
    '/ws',
    {
      websocket: true,
      preValidation: async (request, reply) => {
        const user = await resolveSessionUser(request);
        if (!user) {
          reply.code(401).send({ error: 'no session' });
          return;
        }
        request.sessionUser = user;
        request.sessionRatings = await getRatingsFor(user.id);
      },
    },
    (socket, request) => {
      const user = request.sessionUser;
      const ratings = request.sessionRatings;
      if (!user || !ratings) return; // unreachable: preValidation already rejected this case
      attachConnection(socket, request, user, ratings, routeClientMessage, routeDisconnect);
      routeConnect(user.id);
    }
  );

  app.setNotFoundHandler((request, reply) => {
    const url = request.raw.url ?? '';
    if (url.startsWith('/api/') || url === '/ws' || request.method !== 'GET') {
      reply.code(404).send({ error: 'not found' });
      return;
    }
    reply.sendFile('index.html');
  });

  return app;
}
