import type { Hand, LeaderboardRow, Match, Me, Profile } from './types.ts';
import type { UserSummary } from '@opentable/protocol';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/* Every call is same-origin and credentialed: the session is a cookie the
   server sets on the first /api/me. An error body is {error: string}; the
   message is shown to the player, so it is read out rather than swallowed. */
async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}) },
    ...init,
  });
  if (!res.ok) {
    let message = `${path} returned ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* a non-JSON error body is not worth reporting verbatim */
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

const post = <T>(path: string, body?: unknown) =>
  req<T>(path, { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export const api = {
  me: () => req<Me>('/api/me'),
  leaderboard: () => req<LeaderboardRow[]>('/api/leaderboard'),
  user: (name: string) => req<Profile>(`/api/users/${encodeURIComponent(name)}`),
  match: (id: string) => req<Match>(`/api/matches/${encodeURIComponent(id)}`),
  /* A hand's primary key is '<match id>-<number>' (server/db/schema.sql), so a
     hand is addressable from a match URL without a lookup table. */
  hand: (matchId: string, n: number) => req<Hand>(`/api/hands/${encodeURIComponent(`${matchId}-${n}`)}`),
  claim: (name: string, password: string) => post<UserSummary>('/api/claim', { name, password }),
  login: (name: string, password: string) => post<UserSummary>('/api/login', { name, password }),
  logout: () => post<{ ok: true }>('/api/logout'),
};
