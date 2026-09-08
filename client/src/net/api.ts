import type {
  BotRow, Challenge, CreatedChallenge, FeedMatch, Hand, LeaderboardRow, LiveMatch, Match, Me, Profile, SiteStats,
} from './types.ts';
import type { Mode, UserSummary } from '@opentable/protocol';

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
  /* One board per mode; the server defaults to heads-up and falls back to it
     for anything it does not recognise. */
  leaderboard: (mode?: Mode) =>
    req<LeaderboardRow[]>(mode ? `/api/leaderboard?mode=${encodeURIComponent(mode)}` : '/api/leaderboard'),
  /* The bot roster with the level each one plays at. Bots are off the
     leaderboard, so this is the only list of them. */
  bots: () => req<BotRow[]>('/api/bots'),
  user: (name: string) => req<Profile>(`/api/users/${encodeURIComponent(name)}`),
  match: (id: string) => req<Match>(`/api/matches/${encodeURIComponent(id)}`),
  /* A hand's primary key is '<match id>-<number>' (server/db/schema.sql), so a
     hand is addressable from a match URL without a lookup table. */
  hand: (matchId: string, n: number) => req<Hand>(`/api/hands/${encodeURIComponent(`${matchId}-${n}`)}`),
  /* The home feed. `recent` and `live` are lists a page renders whole;
     `stats` is polled, and the server caches it for five seconds so a room
     full of open tabs costs one query. */
  recent: (limit = 20) => req<FeedMatch[]>(`/api/recent?limit=${limit}`),
  stats: () => req<SiteStats>('/api/stats'),
  live: () => req<LiveMatch[]>('/api/live'),
  /* Play a friend. The link is made by the person sharing it and spent by the
     person who opens it; either may be a guest, so none of these calls needs
     an account. */
  createChallenge: (mode: Mode, rated: boolean) => post<CreatedChallenge>('/api/challenges', { mode, rated }),
  challenge: (id: string) => req<Challenge>(`/api/challenges/${encodeURIComponent(id)}`),
  acceptChallenge: (id: string) => post<{ matchId: string }>(`/api/challenges/${encodeURIComponent(id)}/accept`),
  cancelChallenge: (id: string) =>
    req<{ ok: true }>(`/api/challenges/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  claim: (name: string, password: string) => post<UserSummary>('/api/claim', { name, password }),
  login: (name: string, password: string) => post<UserSummary>('/api/login', { name, password }),
  logout: () => post<{ ok: true }>('/api/logout'),
};
