import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { abortStalePlayingMatches, applySchema } from './db.js';
import { registerRoutes } from './routes.js';
import { resolveSessionUser } from './auth.js';
import { attachConnection } from './ws/hub.js';
import { routeClientMessage, routeConnect, routeDisconnect } from './ws/router.js';

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

  const app = Fastify({ logger: true });

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
      },
    },
    (socket, request) => {
      const user = request.sessionUser;
      if (!user) return; // unreachable: preValidation already rejected this case
      attachConnection(socket, request, user, routeClientMessage, routeDisconnect);
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
