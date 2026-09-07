import type { UserSummary } from '@opentable/protocol';

/* Every REST call is same-origin and credentialed: the session is a cookie the
   server sets on the first /api/me. */
async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', headers: { accept: 'application/json' } });
  if (!res.ok) throw new ApiError(res.status, `${path} returned ${res.status}`);
  return (await res.json()) as T;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export interface LeaderboardRow {
  name: string;
  rating: number;
  rd: number;
  provisional?: boolean;
  matches?: number;
}

export const api = {
  me: () => get<UserSummary>('/api/me'),
  leaderboard: () => get<LeaderboardRow[] | { users: LeaderboardRow[] }>('/api/leaderboard'),
  user: (name: string) => get<unknown>(`/api/users/${encodeURIComponent(name)}`),
  hand: (matchId: string, n: number) => get<unknown>(`/api/hands/${encodeURIComponent(matchId)}?n=${n}`),
};

/* The leaderboard route may hand back a bare array or an envelope; normalise
   once here rather than at every call site. */
export function rows(payload: LeaderboardRow[] | { users: LeaderboardRow[] }): LeaderboardRow[] {
  return Array.isArray(payload) ? payload : (payload?.users ?? []);
}
