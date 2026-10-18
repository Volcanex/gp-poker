import { createHash, createPublicKey, randomBytes, verify as verifySignature } from 'node:crypto';
import type { JsonWebKey } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { config } from './config.js';
import {
  SESSION_COOKIE,
  createSessionForUser,
  isHttps,
  mintGuest,
  setSessionCookie,
} from './auth.js';
import {
  claimGuestWithGoogle,
  deleteExpiredOauthStates,
  deleteSession,
  getSessionUser,
  getUserByGoogleSub,
  insertOauthState,
  linkGoogleToUser,
  takeOauthState,
  type UserRow,
} from './db.js';
import { isUniqueViolation } from './pgError.js';

/* Google sign-in: the second way to claim an account, beside the name and
   password in ./auth.ts. Authorization code flow with PKCE, and the whole of
   it lives here: the two browser routes, the state the flow is bound to, the
   token exchange, the id_token verification and the one function that decides
   which account a Google identity means.

   The join key is Google's subject id (`sub`) and nothing else. An email
   address is a thing an account can change, and a changed one that still
   matched would hand somebody a stranger's rating; `sub` is the only
   identifier Google promises is stable. Nothing here writes an email down,
   because nothing here reads one.

   The claim carries the account over rather than making a new one: a guest
   who presses the button keeps the row they have been playing on, which means
   they keep their rating, their history and the generated name they played
   under. There is no name field in this path at all, which is the point of
   it: the site's own claim form already asks for one. */

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const STATE_TTL_MS = 10 * 60 * 1000;
// Google's signing keys rotate on the order of a day, and the JWKS response
// says how long it may be cached. An hour is well inside that; the second
// fetch below is what covers a rotation that happened sooner.
const JWKS_TTL_MS = 60 * 60 * 1000;
// A kid this process has never seen is the one legitimate reason to refetch
// early, and also exactly what an attacker would send to make us refetch on
// every request, so a second fetch waits at least this long after the last.
const JWKS_MIN_REFETCH_MS = 60 * 1000;

type FetchLike = typeof fetch;

interface GoogleSettings {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authUrl: string;
  tokenUrl: string;
  jwksUrl: string;
  fetch: FetchLike;
  now: () => number;
}

function defaultSettings(): GoogleSettings {
  return {
    clientId: config.googleClientId,
    clientSecret: config.googleClientSecret,
    redirectUri: config.googleRedirectUri,
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
    fetch: (...args) => fetch(...args),
    now: () => Date.now(),
  };
}

let settings = defaultSettings();
let jwks: { keys: JsonWebKey[]; fetchedAt: number } | null = null;

/* The seam, in the spirit of `configureArena` and the rest: a test points the
   three Google URLs and the fetch at its own signing key and drives the real
   routes, rather than at a parallel path that only looks like them. Resetting
   the key cache with the settings matters as much as the settings do: a suite
   that left one file's fake keys cached would verify the next file's tokens
   against them. */
export function configureGoogle(overrides: Partial<GoogleSettings>): void {
  settings = { ...settings, ...overrides };
  jwks = null;
}

export function resetGoogle(): void {
  settings = defaultSettings();
  jwks = null;
}

// Whether the button is offered at all. Both halves of the credential have to
// be present: a client id with no secret cannot complete the exchange, and a
// button that fails at the last step is worse than no button.
export function googleConfigured(): boolean {
  return Boolean(settings.clientId && settings.clientSecret);
}

/* What the callback tells the page it lands on, as a `?ot_auth=` code the
   client turns into copy (`client/src/ui/auth.tsx`). A code rather than a
   message because the wording belongs to the interface, and because a message
   round-tripped through a query string is a message somebody else can put on
   our page. */
export type GoogleResult =
  | 'ok'
  | 'off' // the box has no credentials configured
  | 'state' // no state, a spent one, an expired one, or one from another browser
  | 'denied' // the person said no at Google, or came back without a code
  | 'google' // the exchange or the id_token did not check out
  | 'linked' // that Google account is already somebody else's here
  | 'account-linked'; // this account already signs in with a different Google account

export type GoogleLinkOutcome =
  | { ok: true; user: UserRow; how: 'signed-in' | 'claimed' | 'linked' }
  | { ok: false; error: Extract<GoogleResult, 'linked' | 'account-linked' | 'state'> };

/* Which account a verified Google identity means, and the one place the two
   histories problem is settled.

   - Already linked to the account in this browser: nothing to do but say so.
   - Already linked to a **different** account, and this browser is a guest:
     sign into the linked one. That is what logging in with a password does
     today, and it merges nothing: the guest row keeps its own rating and its
     own history, and is simply not this browser's account any more.
   - Already linked to a different account while this browser is a claimed
     one: refused. Both rows are somebody's, and the only ways to proceed
     would be to merge two rating histories or to move the link off an account
     that relies on it. Neither is a thing to do silently, so it fails and
     says why.
   - Not linked, and this browser is a guest: the claim, carrying the row
     over.
   - Not linked, and this browser is a claimed account: the link is added, so
     an account that was claimed with a password can use the button from now
     on. An account already wearing a different Google link is refused for the
     same reason as above. */
export async function linkGoogleAccount(current: UserRow, sub: string): Promise<GoogleLinkOutcome> {
  const linked = await getUserByGoogleSub(sub);
  if (linked) {
    if (linked.id === current.id) return { ok: true, user: linked, how: 'signed-in' };
    if (!current.guest) return { ok: false, error: 'linked' };
    return { ok: true, user: linked, how: 'signed-in' };
  }
  if (current.googleSub && current.googleSub !== sub) return { ok: false, error: 'account-linked' };
  if (current.guest) {
    const user = await claimGuestWithGoogle(current.id, sub);
    // Only reachable if the same account was claimed by another tab in the
    // milliseconds this took, which is the password path's own answer too.
    if (!user) return { ok: false, error: 'state' };
    return { ok: true, user, how: 'claimed' };
  }
  try {
    const user = await linkGoogleToUser(current.id, sub);
    if (!user) return { ok: false, error: 'account-linked' };
    return { ok: true, user, how: 'linked' };
  } catch (err) {
    // The unique index caught a sub that became somebody else's between the
    // lookup above and this write. The database is the thing that guarantees
    // one Google account is one account here; this branch is it doing so.
    if (isUniqueViolation(err)) return { ok: false, error: 'linked' };
    throw err;
  }
}

/* Where the browser is sent afterwards. Only a path on this origin is ever
   accepted: `//evil.example` is a protocol-relative URL that a browser reads
   as another origin, a backslash is read as a slash by enough of them to
   count, and anything not starting with a slash is not a path at all. The
   default is the home page, so a rejected value costs a redirect rather than
   an error. */
export function sameOriginPath(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.startsWith('/')) return '/';
  if (raw.startsWith('//') || raw.includes('\\')) return '/';
  // eslint-disable-next-line no-control-regex
  if (/[ -]/.test(raw)) return '/';
  return raw;
}

function withResult(pathname: string, result: GoogleResult): string {
  // The base is thrown away: this parses a path that has already been proved
  // to be one, so that an existing query string survives having a parameter
  // added to it.
  const url = new URL(pathname, 'https://everyonepoker.invalid');
  url.searchParams.set('ot_auth', result);
  return `${url.pathname}${url.search}${url.hash}`;
}

function land(reply: FastifyReply, path: string, result: GoogleResult) {
  // A redirect that decides who somebody is signed in as must not be cached
  // or replayed by anything between here and the browser.
  reply.header('Cache-Control', 'no-store');
  return reply.redirect(withResult(path, result), 302);
}

function base64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function decodeSegment(segment: string): Record<string, unknown> {
  const json = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  if (!json || typeof json !== 'object') throw new Error('id_token segment is not an object');
  return json as Record<string, unknown>;
}

async function refreshJwks(): Promise<void> {
  const res = await settings.fetch(settings.jwksUrl, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`jwks endpoint answered ${res.status}`);
  const body = (await res.json()) as { keys?: JsonWebKey[] };
  if (!Array.isArray(body.keys) || body.keys.length === 0) throw new Error('jwks carried no keys');
  jwks = { keys: body.keys, fetchedAt: settings.now() };
}

async function keyFor(kid: string): Promise<JsonWebKey> {
  if (!jwks || settings.now() - jwks.fetchedAt > JWKS_TTL_MS) await refreshJwks();
  let found = jwks?.keys.find((k) => (k as { kid?: string }).kid === kid);
  if (!found && jwks && settings.now() - jwks.fetchedAt > JWKS_MIN_REFETCH_MS) {
    await refreshJwks();
    found = jwks?.keys.find((k) => (k as { kid?: string }).kid === kid);
  }
  if (!found) throw new Error('id_token was signed by a key Google does not publish');
  return found;
}

export interface GoogleIdentity {
  sub: string;
}

/* The whole trust boundary. An id_token is a bearer string that arrived over
   a connection we opened, which is necessary but not sufficient: it is the
   signature, the issuer, the audience, the expiry and the nonce together that
   say this token was minted by Google, for this client, for this request, and
   is still valid. Anything short of all five is an unverified token, and an
   unverified token is somebody else's account.

   `aud` is compared as a string. The spec allows an array; Google issues a
   string, and an array here would mean a token minted for somebody else's
   client that happens to list ours, which is not a thing to accept quietly. */
export async function verifyIdToken(idToken: string, nonce: string): Promise<GoogleIdentity> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('id_token is not a JWS');
  const header = decodeSegment(parts[0]);
  if (header.alg !== 'RS256') throw new Error(`id_token alg is ${String(header.alg)}, not RS256`);
  const key = createPublicKey({ key: await keyFor(String(header.kid ?? '')), format: 'jwk' });
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
  const signature = Buffer.from(parts[2], 'base64url');
  if (!verifySignature('RSA-SHA256', signed, key, signature)) {
    throw new Error('id_token signature did not verify');
  }
  const claims = decodeSegment(parts[1]);
  if (typeof claims.iss !== 'string' || !GOOGLE_ISSUERS.includes(claims.iss)) {
    throw new Error('id_token was not issued by Google');
  }
  if (claims.aud !== settings.clientId) throw new Error('id_token was minted for another client');
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= settings.now()) {
    throw new Error('id_token has expired');
  }
  if (claims.nonce !== nonce) throw new Error('id_token answers another request');
  if (typeof claims.sub !== 'string' || !claims.sub) throw new Error('id_token carries no sub');
  return { sub: claims.sub };
}

async function exchangeCode(code: string, codeVerifier: string): Promise<string> {
  const body = new URLSearchParams({
    code,
    client_id: settings.clientId,
    client_secret: settings.clientSecret,
    redirect_uri: settings.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
  });
  const res = await settings.fetch(settings.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
  });
  // The status and nothing else: a token endpoint's body carries credentials
  // on the way in and tokens on the way out, and neither belongs in a log.
  if (!res.ok) throw new Error(`token endpoint answered ${res.status}`);
  const json = (await res.json()) as { id_token?: unknown };
  if (typeof json.id_token !== 'string' || !json.id_token) {
    throw new Error('token response carried no id_token');
  }
  return json.id_token;
}

// Binds a flow opened by a browser with no session to that browser.
const BINDING_COOKIE = 'ot_oauth';

export function registerGoogleRoutes(app: FastifyInstance): void {
  /* The button is a link to this. It is a navigation and not an /api call
     because the browser has to end up at Google's own page: an XHR cannot,
     and a client that built the authorize URL itself would be a client
     holding the state this flow is bound to. */
  app.get<{ Querystring: { next?: string } }>('/auth/google/start', async (request, reply) => {
    const next = sameOriginPath(request.query?.next);
    if (!googleConfigured()) return land(reply, next, 'off');
    /* No guest is minted here. This is a plain link on every page a crawler
       renders, and a GET that minted gave every crawl a guest row (1.6k a
       day in October 2026, nearly all Reflectionbot). A browser that already
       has a session binds the state to it. One that has none is bound by a
       short-lived cookie instead, and its account is made in the callback,
       once Google has said who it is. */
    const cookie = request.cookies[SESSION_COOKIE];
    const current = cookie ? await getSessionUser(cookie) : null;
    const sessionToken = current && cookie ? cookie : null;
    let browserBinding: string | null = null;
    if (!sessionToken) {
      browserBinding = base64url(randomBytes(32));
      reply.setCookie(BINDING_COOKIE, browserBinding, {
        httpOnly: true,
        sameSite: 'lax',
        secure: isHttps(request),
        path: '/auth/google',
        maxAge: STATE_TTL_MS / 1000,
      });
    }
    await deleteExpiredOauthStates();
    const state = base64url(randomBytes(32));
    const codeVerifier = base64url(randomBytes(32));
    const nonce = base64url(randomBytes(16));
    await insertOauthState({
      state,
      codeVerifier,
      nonce,
      sessionToken,
      browserBinding,
      redirectTo: next,
      expiresAt: new Date(settings.now() + STATE_TTL_MS),
    });
    const url = new URL(settings.authUrl);
    url.searchParams.set('client_id', settings.clientId);
    url.searchParams.set('redirect_uri', settings.redirectUri);
    url.searchParams.set('response_type', 'code');
    // Nothing here reads an email, but `openid` alone is not a scope Google
    // is happy to issue on its own, and the account chooser reads better with
    // it. The id_token's `sub` is all that is kept.
    url.searchParams.set('scope', 'openid email');
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('code_challenge', base64url(createHash('sha256').update(codeVerifier).digest()));
    url.searchParams.set('code_challenge_method', 'S256');
    // Somebody signed into several Google accounts is asked which one, rather
    // than being silently signed in as whichever one their browser prefers.
    url.searchParams.set('prompt', 'select_account');
    reply.header('Cache-Control', 'no-store');
    return reply.redirect(url.toString(), 302);
  });

  app.get<{ Querystring: { state?: string; code?: string; error?: string } }>(
    '/auth/google/callback',
    async (request, reply) => {
      const q = request.query ?? {};
      // Reading the state spends it, whatever happens next, so a code cannot
      // be replayed against it.
      const row = q.state ? await takeOauthState(q.state) : null;
      if (!row) return land(reply, '/', 'state');
      const next = sameOriginPath(row.redirectTo);
      // The binding: the state has to have been issued to this browser's
      // session. Without this the flow is a CSRF, since the code and the
      // state in the query are both things an attacker can put in a link.
      const cookie = request.cookies[SESSION_COOKIE];
      const binding = request.cookies[BINDING_COOKIE];
      const bySession = !!row.sessionToken && cookie === row.sessionToken;
      const byBinding = !row.sessionToken && !!row.browserBinding && binding === row.browserBinding;
      if (!bySession && !byBinding) return land(reply, next, 'state');
      if (binding) reply.clearCookie(BINDING_COOKIE, { path: '/auth/google' });
      if (row.expiresAt.getTime() <= settings.now()) return land(reply, next, 'state');
      if (q.error || !q.code) return land(reply, next, 'denied');
      const sessionUser = bySession ? await getSessionUser(cookie as string) : null;
      if (bySession && !sessionUser) return land(reply, next, 'state');

      let identity: GoogleIdentity;
      try {
        identity = await verifyIdToken(await exchangeCode(q.code, row.codeVerifier), row.nonce);
      } catch (err) {
        request.log.warn({ reason: (err as Error).message }, 'google sign-in did not verify');
        return land(reply, next, 'google');
      }

      if (!sessionUser) {
        // A browser that arrived with no session: sign it into the account
        // this Google identity already has, or make that account now. This is
        // the only place the flow mints, and only after Google has answered.
        const linked = await getUserByGoogleSub(identity.sub);
        const user = linked ?? (await claimGuestWithGoogle((await mintGuest()).id, identity.sub));
        if (!user) return land(reply, next, 'state');
        const session = await createSessionForUser(user.id);
        setSessionCookie(request, reply, session.token);
        return land(reply, next, 'ok');
      }
      const user = sessionUser;

      const outcome = await linkGoogleAccount(user, identity.sub);
      if (!outcome.ok) return land(reply, next, outcome.error);
      if (outcome.user.id !== user.id) {
        // Signing into a different account, so the guest session this browser
        // arrived with is spent rather than left valid alongside the new one.
        await deleteSession(cookie as string);
        const session = await createSessionForUser(outcome.user.id);
        setSessionCookie(request, reply, session.token);
      }
      return land(reply, next, 'ok');
    }
  );
}
