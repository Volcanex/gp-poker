import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { abortStalePlayingMatches, applySchema, getRatingsFor } from './db.js';
import { registerRoutes } from './routes.js';
import { loadShell, registerCrawlRoutes, sendShell, shellLoaded } from './meta.js';
import { resolveSessionUser } from './auth.js';
import { attachConnection, attachWatcher } from './ws/hub.js';
import { routeClientMessage, routeConnect, routeDisconnect } from './ws/router.js';
import { ensureBots, setBotDispatch } from './bots/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = process.env.CLIENT_DIST
  ? path.resolve(process.env.CLIENT_DIST)
  : path.resolve(here, '..', '..', 'client', 'dist');

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

  /* A profile picture is sent as the image itself, so the body needs to reach
     the route as bytes rather than through the JSON parser. The pattern is
     `image/*` rather than the two types that are actually allowed, because a
     content type Fastify has no parser for is refused with a framework 415
     that says nothing useful: letting the route see it is what lets it answer
     "a picture must be sent as image/webp or image/png" and, for a file whose
     magic number disagrees with its header, say which it really is. The route
     sets its own body limit; nothing else here takes an image body. */
  app.addContentTypeParser(/^image\/.+$/, { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body);
  });
  // index.html is deliberately not served from disk. Every HTML response goes
  // through the not-found handler and out of meta.ts with a title and a
  // description that are true of the page asked for, and a file route for it
  // would be the one way to get the generic head instead. Ignoring it here
  // also drops the '/' index route, so the home page takes the same path as
  // every other client route.
  await app.register(fastifyStatic, {
    root: clientDist,
    wildcard: false,
    globIgnore: ['index.html'],
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
  registerCrawlRoutes(app);
  // Read once, here, so a request only has to insert its own tags. A build
  // with no index.html leaves the shell unloaded and the fallback below
  // serves the file the way it always did, which keeps that failure loud.
  await loadShell(clientDist);

  app.get(
    '/ws',
    {
      websocket: true,
      // No session is not a refusal: the socket watches (see attachWatcher).
      preValidation: async (request) => {
        const user = await resolveSessionUser(request);
        if (!user) return;
        request.sessionUser = user;
        request.sessionRatings = await getRatingsFor(user.id);
      },
    },
    (socket, request) => {
      const user = request.sessionUser;
      const ratings = request.sessionRatings;
      if (!user || !ratings) {
        attachWatcher(socket, routeClientMessage, routeDisconnect);
        return;
      }
      attachConnection(socket, request, user, ratings, routeClientMessage, routeDisconnect);
      routeConnect(user.id);
    }
  );

  // Every client route lands here, including '/'. An id nobody has still gets
  // the shell with a 200: the SPA is what says there is no such match, and a
  // crawler asking for a page that has gone is not an error worth a 404 body
  // it cannot render.
  app.setNotFoundHandler(async (request, reply) => {
    const url = request.raw.url ?? '';
    // HEAD as well as GET: '/' no longer has a file route of its own, and an
    // uptime check that asks for the head of the home page should get one.
    const readable = request.method === 'GET' || request.method === 'HEAD';
    if (url.startsWith('/api/') || url === '/ws' || !readable) {
      return reply.code(404).send({ error: 'Not found' });
    }
    if (!shellLoaded()) return reply.sendFile('index.html');
    return sendShell(request, reply);
  });

  return app;
}
