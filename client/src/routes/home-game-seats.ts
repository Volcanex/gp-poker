import type { LobbySeat } from '@opentable/protocol';

/* The pure half of the home game lobby: who is sitting where, and what happens
   to the chairs nobody took. It is separate from the page for the same reason
   the replay's analysis is separate from its panel: the arithmetic of a table
   filling up is worth testing without a browser in the way. */

export type LobbyChair =
  | { kind: 'taken'; seat: LobbySeat }
  | { kind: 'empty'; level: number };

export interface LobbyLayout {
  chairs: LobbyChair[]; // always exactly as long as the table has seats
  humans: number;
  bots: number; // empty chairs, which is what the bots will fill on start
  full: boolean;
}

/* The host sits first whatever order the seats arrived in, because the table
   reads as theirs, and everyone else keeps the order they joined in.

   Empty chairs carry the level they will be filled at rather than being blank:
   the host has already chosen it, so an empty seat at this table is a bot
   waiting to be dealt in and a person who has not arrived yet, both at once,
   and the page says both. A lobby with more seats than the table has (which
   only a shrunken format could produce) is clamped rather than overflowing. */
export function lobbyLayout(seats: LobbySeat[], players: number, botLevel: number): LobbyLayout {
  const ordered = [...seats].sort((a, b) => Number(b.host) - Number(a.host));
  const taken = ordered.slice(0, Math.max(0, players));
  const chairs: LobbyChair[] = taken.map((seat) => ({ kind: 'taken' as const, seat }));
  while (chairs.length < players) chairs.push({ kind: 'empty', level: botLevel });
  return {
    chairs,
    humans: taken.length,
    bots: Math.max(0, players - taken.length),
    full: taken.length >= players,
  };
}

/* What the start button promises, in one sentence, so the host is never
   surprised by the table they open. A rating needs two people at it: six seats
   of Glicko-2 against bots whose strength the host chose is a number anyone
   could dial in, so one human plays casual whatever was asked for. */
export function startBlurb(humans: number, bots: number, rated: boolean): string {
  const people = humans === 1 ? '1 person' : `${humans} people`;
  const seats = bots === 1 ? '1 seat' : `${bots} seats`;
  const fill = bots === 0 ? 'every seat is taken' : `${seats} filled by bots`;
  if (!rated) return `${people} at the table, ${fill}. Casual, so nobody's rating moves.`;
  if (humans < 2) return `${people} at the table, ${fill}. It plays casual until a second person joins.`;
  return `${people} at the table, ${fill}. Rated.`;
}

/* How long the link has left, in the largest unit that still says something.
   Under an hour it counts minutes, because that is when it starts to matter. */
export function expiryLine(expiresAt: string, now = Date.now()): string {
  const left = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(left) || left <= 0) return 'This link has expired.';
  const mins = Math.round(left / 60_000);
  if (mins < 60) return `This link works for another ${mins} ${mins === 1 ? 'minute' : 'minutes'}.`;
  const hours = Math.round(mins / 60);
  return `This link works for another ${hours} ${hours === 1 ? 'hour' : 'hours'}.`;
}
