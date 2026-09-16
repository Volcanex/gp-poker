import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateKeyPairSync, sign as signWith, type KeyObject } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { makeApp, deleteUser, mintGuestSession } from './helpers.js';
import { sql } from '../src/db.js';
import { configureGoogle, resetGoogle, sameOriginPath } from '../src/google.js';

/* Google sign-in, driven through the real routes against a Google made of a
   key pair and a fetch. The seam (`configureGoogle`) exists so the thing under
   test is the flow this server actually runs: the state it issues, the
   challenge it sends, the signature it checks and the account it decides on,
   rather than a parallel path that only looks like one. */

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const AUTH_URL = 'https://accounts.test.invalid/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth.test.invalid/token';
const JWKS_URL = 'https://oauth.test.invalid/certs';
const KID = 'test-key-1';

const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...(pair.publicKey.export({ format: 'jwk' }) as object), kid: KID, alg: 'RS256', use: 'sig' };

let clock = Date.now();
let nextIdToken: string | null = null;
let lastTokenBody: URLSearchParams | null = null;

function segment(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function idToken(claims: Record<string, unknown>, key: KeyObject = pair.privateKey): string {
  const body = `${segment({ alg: 'RS256', kid: KID, typ: 'JWT' })}.${segment(claims)}`;
  return `${body}.${signWith('RSA-SHA256', Buffer.from(body), key).toString('base64url')}`;
}

function goodClaims(sub: string, nonce: string): Record<string, unknown> {
  return {
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub,
    email: 'someone@example.com',
    exp: Math.floor(clock / 1000) + 600,
    iat: Math.floor(clock / 1000),
    nonce,
  };
}

const fakeFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  if (url === JWKS_URL) {
    return new Response(JSON.stringify({ keys: [jwk] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (url === TOKEN_URL) {
    lastTokenBody = new URLSearchParams(String(init?.body ?? ''));
    if (!nextIdToken) return new Response('{}', { status: 400 });
    return new Response(JSON.stringify({ id_token: nextIdToken, token_type: 'Bearer' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  return new Response('not found', { status: 404 });
};

describe('google sign-in', () => {
  let app: FastifyInstance;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    app = await makeApp();
    configureGoogle({
      clientId: CLIENT_ID,
      clientSecret: 'test-secret',
      redirectUri: 'https://everyonepoker.test/auth/google/callback',
      authUrl: AUTH_URL,
      tokenUrl: TOKEN_URL,
      jwksUrl: JWKS_URL,
      fetch: fakeFetch,
      now: () => clock,
    });
  });

  afterAll(async () => {
    for (const id of createdUserIds) await deleteUser(id);
    resetGoogle();
    await app.close();
  });

  beforeEach(() => {
    clock = Date.now();
    nextIdToken = null;
    lastTokenBody = null;
  });

  async function guest() {
    const session = await mintGuestSession(app);
    createdUserIds.push(session.id);
    return session;
  }

  /* Opens the flow the way the button does and answers what Google was asked
     for, so a test can mint exactly the token that request expects. */
  async function start(token: string, next = '/') {
    const res = await app.inject({
      method: 'GET',
      url: `/auth/google/start?next=${encodeURIComponent(next)}`,
      cookies: { ot_session: token },
    });
    expect(res.statusCode).toBe(302);
    const url = new URL(res.headers.location as string);
    return {
      res,
      url,
      state: url.searchParams.get('state') as string,
      nonce: url.searchParams.get('nonce') as string,
    };
  }

  function callback(token: string, query: Record<string, string>) {
    const search = new URLSearchParams(query).toString();
    return app.inject({
      method: 'GET',
      url: `/auth/google/callback?${search}`,
      cookies: { ot_session: token },
    });
  }

  async function signIn(token: string, sub: string, next = '/') {
    const opened = await start(token, next);
    nextIdToken = idToken(goodClaims(sub, opened.nonce));
    return callback(token, { state: opened.state, code: 'auth-code' });
  }

  function sessionCookie(res: Awaited<ReturnType<typeof callback>>): string | undefined {
    return res.cookies.find((c) => c.name === 'ot_session')?.value;
  }

  it('sends the browser to Google with a state, a nonce and an S256 challenge', async () => {
    const session = await guest();
    const { url, state } = await start(session.token, '/leaderboard');
    expect(url.origin + url.pathname).toBe(AUTH_URL);
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    // The verifier is never sent here: only its hash, which is the whole
    // point of PKCE.
    expect(url.toString()).not.toContain('code_verifier');
    const [row] = await sql`select session_token, redirect_to from oauth_states where state = ${state}`;
    expect(row.sessionToken).toBe(session.token);
    expect(row.redirectTo).toBe('/leaderboard');
  });

  it('claims the guest it was started from, keeping the row, the name and the rating', async () => {
    const session = await guest();
    const before = await app.inject({ method: 'GET', url: '/api/me', cookies: { ot_session: session.token } });
    expect(before.json().guest).toBe(true);

    const res = await signIn(session.token, `sub-claim-${Date.now()}`, '/leaderboard');
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/leaderboard?ot_auth=ok');

    const after = await app.inject({ method: 'GET', url: '/api/me', cookies: { ot_session: session.token } });
    const body = after.json();
    expect(body.id).toBe(session.id);
    expect(body.name).toBe(session.name);
    expect(body.guest).toBe(false);
    expect(body.rating).toBe(before.json().rating);
    const [row] = await sql`select google_sub, password_hash from users where id = ${session.id}`;
    expect(row.googleSub).toBeTruthy();
    // Nothing invented a password on the way through: this account signs in
    // with Google and only with Google.
    expect(row.passwordHash).toBeNull();
  });

  it('sends the verifier whose challenge it opened with', async () => {
    const session = await guest();
    const { state, nonce, url } = await start(session.token);
    nextIdToken = idToken(goodClaims(`sub-pkce-${Date.now()}`, nonce));
    await callback(session.token, { state, code: 'auth-code' });
    const verifier = lastTokenBody?.get('code_verifier') as string;
    expect(verifier).toBeTruthy();
    const { createHash } = await import('node:crypto');
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(
      url.searchParams.get('code_challenge')
    );
    expect(lastTokenBody?.get('grant_type')).toBe('authorization_code');
  });

  it('refuses a state it never issued, and one it has already spent', async () => {
    const session = await guest();
    const unknown = await callback(session.token, { state: 'not-a-state', code: 'auth-code' });
    expect(unknown.headers.location).toBe('/?ot_auth=state');

    const { state, nonce } = await start(session.token, '/leaderboard');
    nextIdToken = idToken(goodClaims(`sub-replay-${Date.now()}`, nonce));
    const first = await callback(session.token, { state, code: 'auth-code' });
    expect(first.headers.location).toBe('/leaderboard?ot_auth=ok');
    // The same code and state again: the row was spent by the read.
    const replay = await callback(session.token, { state, code: 'auth-code' });
    expect(replay.headers.location).toBe('/?ot_auth=state');
  });

  it('refuses a state carried to another browser', async () => {
    const opener = await guest();
    const attacker = await guest();
    const { state, nonce } = await start(opener.token, '/friends');
    nextIdToken = idToken(goodClaims(`sub-crossed-${Date.now()}`, nonce));
    const res = await callback(attacker.token, { state, code: 'auth-code' });
    expect(res.headers.location).toBe('/friends?ot_auth=state');
    const [row] = await sql`select guest from users where id = ${attacker.id}`;
    expect(row.guest).toBe(true);
  });

  it('refuses a state that has expired', async () => {
    const session = await guest();
    const { state, nonce } = await start(session.token);
    clock += 11 * 60 * 1000;
    nextIdToken = idToken(goodClaims(`sub-expired-${Date.now()}`, nonce));
    const res = await callback(session.token, { state, code: 'auth-code' });
    expect(res.headers.location).toBe('/?ot_auth=state');
  });

  it('says so plainly when Google sends back a refusal', async () => {
    const session = await guest();
    const { state } = await start(session.token);
    const res = await callback(session.token, { state, error: 'access_denied' });
    expect(res.headers.location).toBe('/?ot_auth=denied');
  });

  it('refuses an id_token that does not check out', async () => {
    const session = await guest();
    const cases: Record<string, (nonce: string) => string> = {
      'a signature from another key': (nonce) =>
        idToken(goodClaims('sub-forged', nonce), otherPair.privateKey),
      'an audience that is not us': (nonce) =>
        idToken({ ...goodClaims('sub-forged', nonce), aud: 'somebody-else.apps.googleusercontent.com' }),
      'an issuer that is not Google': (nonce) =>
        idToken({ ...goodClaims('sub-forged', nonce), iss: 'https://accounts.evil.example' }),
      'an expiry in the past': (nonce) =>
        idToken({ ...goodClaims('sub-forged', nonce), exp: Math.floor(clock / 1000) - 60 }),
      'a nonce from another request': () => idToken(goodClaims('sub-forged', 'some-other-nonce')),
      'no signature at all': (nonce) => {
        const parts = idToken(goodClaims('sub-forged', nonce)).split('.');
        return `${parts[0]}.${parts[1]}.`;
      },
    };
    for (const [what, mint] of Object.entries(cases)) {
      const { state, nonce } = await start(session.token);
      nextIdToken = mint(nonce);
      const res = await callback(session.token, { state, code: 'auth-code' });
      expect(res.headers.location, what).toBe('/?ot_auth=google');
    }
    const [row] = await sql`select guest, google_sub from users where id = ${session.id}`;
    expect(row.guest).toBe(true);
    expect(row.googleSub).toBeNull();
  });

  it('signs a fresh browser into the account the Google identity already has', async () => {
    const owner = await guest();
    const sub = `sub-return-${Date.now()}`;
    await signIn(owner.token, sub);

    const visitor = await guest();
    const res = await signIn(visitor.token, sub);
    expect(res.headers.location).toBe('/?ot_auth=ok');
    const cookie = sessionCookie(res) as string;
    expect(cookie).toBeTruthy();
    expect(cookie).not.toBe(visitor.token);
    const me = await app.inject({ method: 'GET', url: '/api/me', cookies: { ot_session: cookie } });
    expect(me.json().id).toBe(owner.id);
    // The guest that browser arrived with is left exactly as it was: nothing
    // was merged into anything.
    const [row] = await sql`select guest, google_sub from users where id = ${visitor.id}`;
    expect(row.guest).toBe(true);
    expect(row.googleSub).toBeNull();
  });

  it('refuses a Google account that is already another claimed account, and changes nothing', async () => {
    const owner = await guest();
    const sub = `sub-taken-${Date.now()}`;
    await signIn(owner.token, sub);

    const other = await guest();
    const name = `gtest${Date.now().toString(36)}`;
    const claim = await app.inject({
      method: 'POST',
      url: '/api/claim',
      cookies: { ot_session: other.token },
      payload: { name, password: 'correcthorse' },
    });
    expect(claim.statusCode).toBe(200);

    const res = await signIn(other.token, sub);
    expect(res.headers.location).toBe('/?ot_auth=linked');
    expect(sessionCookie(res)).toBeUndefined();
    const me = await app.inject({ method: 'GET', url: '/api/me', cookies: { ot_session: other.token } });
    expect(me.json().id).toBe(other.id);
    expect(me.json().name).toBe(name);
    const [row] = await sql`select google_sub from users where id = ${other.id}`;
    expect(row.googleSub).toBeNull();
    // And the account that does own it still does.
    const [ownerRow] = await sql`select google_sub from users where id = ${owner.id}`;
    expect(ownerRow.googleSub).toBe(sub);
  });

  it('adds the button to an account that was claimed with a password, then refuses a second one', async () => {
    const session = await guest();
    const name = `gtest${Date.now().toString(36)}b`;
    await app.inject({
      method: 'POST',
      url: '/api/claim',
      cookies: { ot_session: session.token },
      payload: { name, password: 'correcthorse' },
    });

    const first = await signIn(session.token, `sub-added-${Date.now()}`);
    expect(first.headers.location).toBe('/?ot_auth=ok');
    const [row] = await sql`select google_sub, password_hash from users where id = ${session.id}`;
    expect(row.googleSub).toBeTruthy();
    expect(row.passwordHash).toBeTruthy();

    const second = await signIn(session.token, `sub-second-${Date.now()}`);
    expect(second.headers.location).toBe('/?ot_auth=account-linked');
    const [after] = await sql`select google_sub from users where id = ${session.id}`;
    expect(after.googleSub).toBe(row.googleSub);
  });

  it('only ever lands the browser back on a path of this origin', async () => {
    expect(sameOriginPath('/leaderboard')).toBe('/leaderboard');
    expect(sameOriginPath('/m/abc?x=1#hand-3')).toBe('/m/abc?x=1#hand-3');
    expect(sameOriginPath('https://evil.example/')).toBe('/');
    expect(sameOriginPath('//evil.example/')).toBe('/');
    expect(sameOriginPath('/\\evil.example')).toBe('/');
    expect(sameOriginPath('/ok\nLocation: https://evil.example')).toBe('/');
    expect(sameOriginPath(undefined)).toBe('/');

    const session = await guest();
    const opened = await start(session.token, '//evil.example/');
    const [row] = await sql`select redirect_to from oauth_states where state = ${opened.state}`;
    expect(row.redirectTo).toBe('/');
    nextIdToken = idToken(goodClaims(`sub-redirect-${Date.now()}`, opened.nonce));
    const res = await callback(session.token, { state: opened.state, code: 'auth-code' });
    expect(res.headers.location).toBe('/?ot_auth=ok');
  });

  it('offers nothing when the box has no credentials', async () => {
    configureGoogle({ clientId: '', clientSecret: '' });
    try {
      const session = await guest();
      const res = await app.inject({
        method: 'GET',
        url: '/auth/google/start',
        cookies: { ot_session: session.token },
      });
      expect(res.headers.location).toBe('/?ot_auth=off');
      const me = await app.inject({ method: 'GET', url: '/api/me', cookies: { ot_session: session.token } });
      expect(me.json().googleAuth).toBeUndefined();
    } finally {
      configureGoogle({ clientId: CLIENT_ID, clientSecret: 'test-secret' });
    }
    const session = await guest();
    const me = await app.inject({ method: 'GET', url: '/api/me', cookies: { ot_session: session.token } });
    expect(me.json().googleAuth).toBe(true);
  });
});
