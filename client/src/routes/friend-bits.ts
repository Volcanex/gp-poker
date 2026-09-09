import { fmtShortDate } from '../ui/format.ts';
import type { Friend } from '../net/types.ts';

/* The pure half of the friends list: the order it reads in and what each row
   says about where somebody is. Separate from the page for the reason
   `arena-bits.ts` is: the ordering rule and the presence line are what the
   home card and the friends page must not describe differently, and both are
   worth testing without a browser in the way. */

/* Online first, then by when they were last here. Inside the online group,
   whoever is at a table comes before whoever is idle, because a friend
   playing is the one row with something happening on it, and names break the
   last tie so the order does not shuffle between two renders. */
export function sortFriends(friends: Friend[]): Friend[] {
  return [...friends].sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    if (a.online && b.online) {
      const playing = Number(b.playing != null) - Number(a.playing != null);
      if (playing !== 0) return playing;
      return a.name.localeCompare(b.name);
    }
    const seen = new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime();
    if (!Number.isNaN(seen) && seen !== 0) return seen;
    return a.name.localeCompare(b.name);
  });
}

export interface PresenceLine {
  /* Whether the dot beside the line is lit. A friend who is here has one; a
     friend who is not keeps the box and leaves it empty, so a list of names
     cannot go out of line by somebody arriving. */
  here: boolean;
  text: string;
}

/* What a friend is doing, in the fewest words that are true. `myMatch` is the
   table the person reading this is sitting at, which is what makes "at your
   table" a thing that can be said at all: a friend playing somewhere else and
   a friend playing here are the same fact until you know which table is
   yours. */
export function presenceLine(friend: Friend, myMatch: string | null, now = Date.now()): PresenceLine {
  if (friend.playing) {
    if (myMatch && friend.playing === myMatch) return { here: true, text: 'At your table' };
    return { here: true, text: 'Playing' };
  }
  if (friend.online) return { here: true, text: 'Online' };
  return { here: false, text: lastSeen(friend.lastSeenAt, now) };
}

/* Relative while that says more than a date, then the date, which is the same
   bargain the feed's own row makes. "Last here" and not "last seen": the
   answer is about a person being at the site, and a fortnight of it counted
   in hours is a number nobody reads. */
export function lastSeen(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'Away';
  const mins = Math.floor(Math.max(0, now - then) / 60_000);
  if (mins < 1) return 'Just left';
  if (mins < 60) return `Last here ${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Last here ${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Last here ${days} ${days === 1 ? 'day' : 'days'} ago`;
  // The site's own short date, so a friends row and a feed row read alike.
  return `Last here ${fmtShortDate(iso)}`;
}
