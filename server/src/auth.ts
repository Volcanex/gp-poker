import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { generateName } from '@opentable/identity';
import {
  claimGuestUser,
  getSessionUser,
  getUserByNameLower,
  insertGuestUser,
  insertSession,
  touchLastSeen,
  type RatingRow,
  type UserRow,
} from './db.js';
import type { Mode } from '@opentable/protocol';
import { isUniqueViolation } from './pgError.js';

const scrypt = promisify(scryptCb);

declare module 'fastify' {
  interface FastifyRequest {
    sessionUser?: UserRow;
    // Resolved alongside sessionUser in /ws's preValidation so the hub can
    // build the `hi` summary synchronously and keep it the first frame out.
    sessionRatings?: Record<Mode, RatingRow>;
  }
}

export const SESSION_COOKIE = 'ot_session';
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const NAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

export function validateName(name: string): string | null {
  if (!NAME_RE.test(name)) {
    return 'name must be 3-20 characters: letters, digits or underscore';
  }
  if (name.toLowerCase().startsWith('guest-')) {
    return 'name cannot start with guest-';
  }
  return null;
}

// Guests are identified by the `guest` column, not by a name prefix.
// `guest-` stays reserved (see validateName above) so nobody can claim a
// name that looks like the old convention. A two-word generated name
// collides rarely enough that four tries covers it in practice; the
// three-word space is over 10 million, so it is the fallback that actually
// guarantees termination.
export async function mintGuest(): Promise<UserRow> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await insertGuestUser(generateName(Math.random, 2));
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      return await insertGuestUser(generateName(Math.random, 3));
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  throw new Error('could not mint a unique guest name');
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hashHex] = stored.split(':');
  if (!salt || !hashHex) return false;
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hashHex, 'hex');
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

export function createSessionToken(): string {
  return randomBytes(32).toString('hex');
}

export async function createSessionForUser(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await insertSession(token, userId, expiresAt);
  return { token, expiresAt };
}

function isHttps(request: FastifyRequest): boolean {
  const proto = request.headers['x-forwarded-proto'];
  const first = Array.isArray(proto) ? proto[0] : proto;
  return first === 'https' || request.protocol === 'https';
}

export function setSessionCookie(request: FastifyRequest, reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps(request),
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSessionCookie(request: FastifyRequest, reply: FastifyReply): void {
  reply.setCookie(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps(request),
    path: '/',
    maxAge: 0,
  });
}

// Resolves the current session's user without minting a guest. Used for
// websocket upgrades, which must be rejected if there is no valid session.
export async function resolveSessionUser(request: FastifyRequest): Promise<UserRow | null> {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return null;
  const user = await getSessionUser(token);
  if (!user) return null;
  return user;
}

// Resolves the current user for REST calls, minting a guest and setting the
// cookie when there is no valid session. /api/me and friends use this.
export async function requireUser(request: FastifyRequest, reply: FastifyReply): Promise<UserRow> {
  const existing = await resolveSessionUser(request);
  if (existing) {
    await touchLastSeen(existing.id);
    return existing;
  }
  const guest = await mintGuest();
  const { token } = await createSessionForUser(guest.id);
  setSessionCookie(request, reply, token);
  return guest;
}

export async function claimGuest(
  guestId: string,
  name: string,
  password: string
): Promise<{ ok: true; user: UserRow } | { ok: false; error: string }> {
  const nameError = validateName(name);
  if (nameError) return { ok: false, error: nameError };
  if (password.length < 6) return { ok: false, error: 'password must be at least 6 characters' };
  const existing = await getUserByNameLower(name.toLowerCase());
  if (existing) return { ok: false, error: 'name already taken' };
  const passwordHash = await hashPassword(password);
  const user = await claimGuestUser(guestId, name, passwordHash);
  if (!user) return { ok: false, error: 'account is not a guest' };
  return { ok: true, user };
}

export async function login(
  name: string,
  password: string
): Promise<{ ok: true; user: UserRow } | { ok: false; error: string }> {
  const user = await getUserByNameLower(name.toLowerCase());
  if (!user || !user.passwordHash) return { ok: false, error: 'invalid name or password' };
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return { ok: false, error: 'invalid name or password' };
  return { ok: true, user };
}
