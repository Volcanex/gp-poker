import type {
  Arena, ArenaListing, BotRow, Challenge, CreatedChallenge, CreatedHomeGame, Explorer, ExplorerFacing,
  ExplorerPlayers, FeedMatch, Hand, HomeGame, Insights, LeaderboardRow, LiveMatch, Match, Me, PositionKey,
  Profile, PuzzleHand, SiteStats, StartedHomeGame, Ticket, TicketSummary, TicketTarget, TicketViewport,
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
  /* How a player actually plays, per mode. Its own call rather than a field
     on the profile: it is derived from every hand they have played, so it is
     the one payload on this page worth paying for only when it is looked at. */
  insights: (name: string, mode: Mode) =>
    req<Insights>(`/api/users/${encodeURIComponent(name)}/insights?mode=${encodeURIComponent(mode)}`),
  /* The opening explorer's book for one selection. The server holds the whole
     cube in memory and slices it, so flicking a control is a cheap request
     rather than a recount, and it is cacheable for a minute because the book
     only moves when a match finishes. */
  explorer: (mode: Mode, position: PositionKey, facing: ExplorerFacing, players: ExplorerPlayers) =>
    req<Explorer>(
      `/api/explorer?mode=${encodeURIComponent(mode)}&position=${encodeURIComponent(position)}` +
        `&facing=${encodeURIComponent(facing)}&players=${encodeURIComponent(players)}`
    ),
  match: (id: string) => req<Match>(`/api/matches/${encodeURIComponent(id)}`),
  /* A hand's primary key is '<match id>-<number>' (server/db/schema.sql), so a
     hand is addressable from a match URL without a lookup table. */
  hand: (matchId: string, n: number) => req<Hand>(`/api/hands/${encodeURIComponent(`${matchId}-${n}`)}`),
  /* The home feed. `recent` and `live` are lists a page renders whole;
     `stats` is polled, and the server caches it for five seconds so a room
     full of open tabs costs one query. */
  recent: (limit = 20) => req<FeedMatch[]>(`/api/recent?limit=${limit}`),
  /* A random finished heads-up hand with a preflop decision worth grading.
     404 while the site has never stored one, which the puzzle page says out
     loud rather than showing an empty spot. */
  puzzleHand: () => req<PuzzleHand>('/api/puzzles/hand'),
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
  /* Home games: the same link, six seats and a host who says when it starts.
     Making one seats the host, so there is no separate call for that; starting
     one is the only call an ordinary guest at the table cannot make. */
  createHomeGame: (rated: boolean, botLevel: number) =>
    post<CreatedHomeGame>('/api/home-games', { rated, botLevel }),
  homeGame: (id: string) => req<HomeGame>(`/api/home-games/${encodeURIComponent(id)}`),
  joinHomeGame: (id: string) => post<{ ok: true }>(`/api/home-games/${encodeURIComponent(id)}/join`),
  leaveHomeGame: (id: string) => post<{ ok: true }>(`/api/home-games/${encodeURIComponent(id)}/leave`),
  startHomeGame: (id: string) => post<StartedHomeGame>(`/api/home-games/${encodeURIComponent(id)}/start`),
  cancelHomeGame: (id: string) =>
    req<{ ok: true }>(`/api/home-games/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  /* Arenas. The listing stocks the schedule on the server's way past, so the
     first call of the day is what creates the arena it answers with. Joining,
     leaving and pausing all work for a guest, like every other way to play. */
  arenas: () => req<ArenaListing>('/api/arenas'),
  arena: (id: string) => req<Arena>(`/api/arenas/${encodeURIComponent(id)}`),
  joinArena: (id: string) => post<{ ok: true }>(`/api/arenas/${encodeURIComponent(id)}/join`),
  leaveArena: (id: string) => post<{ ok: true }>(`/api/arenas/${encodeURIComponent(id)}/leave`),
  /* The page says which state it wants rather than asking for a toggle, so two
     tabs cannot flip each other. */
  pauseArena: (id: string, paused: boolean) =>
    post<{ ok: true }>(`/api/arenas/${encodeURIComponent(id)}/pause`, { paused }),
  /* The admin layer. Every one of these is 403 for anybody but the admin, so
     nothing here is ever called from a page a player can reach. Creating a
     ticket is the one call with a body worth anything: the drawing is a PNG
     data URL and the server caps it at 1.5 MB. */
  createTicket: (t: {
    url: string;
    path: string;
    note: string;
    viewport: TicketViewport;
    targets: TicketTarget[];
    drawing: string | null;
    build: string | null;
  }) => post<{ id: string }>('/api/tickets', t),
  tickets: (status: 'open' | 'done') => req<TicketSummary[]>(`/api/admin/tickets?status=${status}`),
  ticket: (id: string) => req<Ticket>(`/api/admin/tickets/${encodeURIComponent(id)}`),
  setTicketStatus: (id: string, status: 'open' | 'done') =>
    req<{ id: string; status: string }>(`/api/admin/tickets/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  claim: (name: string, password: string) => post<UserSummary>('/api/claim', { name, password }),
  login: (name: string, password: string) => post<UserSummary>('/api/login', { name, password }),
  logout: () => post<{ ok: true }>('/api/logout'),
};
