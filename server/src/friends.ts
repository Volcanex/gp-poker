import { isBotLevel, DEFAULT_BOT_LEVEL } from '@opentable/protocol';
import type { FriendEvent, InviteKind, Mode, UserSummary } from '@opentable/protocol';
import {
  acceptFriendRequest,
  countFriends,
  countOutgoingRequests,
  deleteFriendInvitesBetween,
  deleteFriendship,
  getAcceptedFriendIds,
  getFriendEdges,
  getFriendInvitesFor,
  getFriendship,
  getOpenHomeGameForHost,
  getPlayedOpponents,
  getRatingsFor,
  getRatingsForUsersByMode,
  getUserById,
  getUserByNameLower,
  insertFriendInvite,
  insertFriendRequest,
  type ChallengeRow,
  type FriendEdgeRow,
  type HomeGameRow,
} from './db.js';
import { challengeSpeed, createChallenge, statusOf as challengeStatusOf } from './challenges.js';
import { createHomeGame, statusOf as homeGameStatusOf } from './home-games.js';
import { mainMode, toUserSummary } from './userView.js';
import { roomForPlayer } from './match/rooms.js';
import { hub } from './ws/hub.js';

/* Friends, presence and invites.

   Three rules shape the whole file.

   **Both sides are claimed accounts.** A guest's name is generated and its row
   may never be seen again, so a friendship with one is a friendship with
   nobody: the name in your list would belong to a browser somebody has since
   closed. Bots are refused for the plainer reason that they are not people. A
   guest who presses a friend control is told to claim the account, which is a
   thing they can do in one form without losing anything.

   **Presence is the socket, and nothing else.** `hub.isConnected` is what
   "online" means here, the same bargain the arena makes about who is pairable:
   there is no page-scoped heartbeat, so a tab left open in the background is
   still somebody who is here. `roomForPlayer` is what "playing" means, asked
   of the room rather than of a column, because a finished room lingers a
   minute before it is unregistered.

   **An invite is a link plus a name.** A challenge invite is a challenge link
   and a home invite is a home game lobby, made through the code that already
   owns each, so there is exactly one path from two people to a table on this
   site. The invite row carries no state about the game, which is why nothing
   has to sweep it: whether it is still worth anything is the link's answer. */

/* Enough that nobody with a real list hits it, low enough that the table is
   not somebody's address book. Both are counted on the way in. */
export const MAX_FRIENDS = 200;
export const MAX_OPEN_OUTGOING = 20;

/* A reload drops the socket and opens another one a moment later, and a
   friends list that flickered offline and back on every time somebody
   refreshed would be a list nobody could read. The offline push waits this
   long and then asks the hub again; a socket that came back inside it cancels
   the push entirely, so the friends of somebody reloading are told nothing at
   all rather than told twice. */
export const OFFLINE_DEBOUNCE_MS = 5_000;

let offlineDebounceMs = OFFLINE_DEBOUNCE_MS;

/* The one seam this file has, in the spirit of `configureArena`: a test that
   wants to watch somebody go offline should not wait five real seconds for
   it. Nothing else about presence is injectable, because nothing else about
   it reads a clock. */
export function configureFriends(options: { offlineDebounceMs?: number } = {}): void {
  if (options.offlineDebounceMs !== undefined) offlineDebounceMs = options.offlineDebounceMs;
}

type Refusal = { ok: false; status: number; error: string };

const CLAIM_NEEDED =
  'Friends need a claimed account. Pick a name and a password, and your rating comes with you.';

// ---- what a page reads ----

/* One friend, as their friend sees them. The rating is for the mode they
   actually play (`mainMode`), with the mode beside it, because a number with
   no mode next to it says nothing on a site that keeps two ratings. */
export interface FriendView {
  id: string;
  name: string;
  country: string | null;
  avatarV: number;
  rating: number;
  mode: Mode;
  online: boolean;
  playing: string | null; // the match they are at right now, or null
  lastSeenAt: string; // ISO
}

/* A request, in either direction. `name` is whose it is: the person who asked
   on an incoming one, the person who was asked on an outgoing one. */
export interface FriendRequestView {
  id: string;
  name: string;
  country: string | null;
  avatarV: number;
  rating: number;
  mode: Mode;
  at: string; // ISO
}

export interface InviteView {
  id: string; // the link's own id, which is what its url ends in
  kind: InviteKind;
  url: string;
  from: UserSummary;
  expiresAt: number; // epoch ms, like every other deadline the client counts
}

export interface FriendsView {
  friends: FriendView[];
  incoming: FriendRequestView[];
  outgoing: FriendRequestView[];
  invites: InviteView[];
}

/* Somebody this player has sat down with, and where they stand with them, so
   the page can offer the right control rather than an Add that answers "you
   already asked". */
export interface PlayedPersonView {
  id: string;
  name: string;
  country: string | null;
  avatarV: number;
  lastPlayedAt: string; // ISO
  status: 'none' | 'friends' | 'incoming' | 'outgoing';
}

function online(userId: string): boolean {
  return hub.isConnected(userId);
}

function playingNow(userId: string): string | null {
  const room = roomForPlayer(userId);
  return room?.active ? room.id : null;
}

/* The whole list in one answer, and one query per thing on it: the edges, the
   ratings of everybody named on them, and the invites. A friends list is read
   on every push, so the cost of it is the cost of the feature. */
export async function friendsView(userId: string, origin: string): Promise<FriendsView> {
  const edges = await getFriendEdges(userId);
  const ratings = await getRatingsForUsersByMode(edges.map((e) => e.otherId));

  const rate = (row: FriendEdgeRow) => {
    const theirs = ratings.get(row.otherId);
    const mode = theirs ? mainMode(theirs) : 'heads-up';
    return { mode, rating: theirs ? Math.round(theirs[mode].rating) : 1500 };
  };

  const friends: FriendView[] = [];
  const incoming: FriendRequestView[] = [];
  const outgoing: FriendRequestView[] = [];

  for (const row of edges) {
    const { mode, rating } = rate(row);
    if (row.status === 'accepted') {
      friends.push({
        id: row.otherId,
        name: row.name,
        country: row.country,
        avatarV: row.avatarV,
        rating,
        mode,
        online: online(row.otherId),
        playing: playingNow(row.otherId),
        lastSeenAt: row.lastSeenAt.toISOString(),
      });
      continue;
    }
    const request: FriendRequestView = {
      id: row.otherId,
      name: row.name,
      country: row.country,
      avatarV: row.avatarV,
      rating,
      mode,
      at: row.createdAt.toISOString(),
    };
    if (row.requesterId === userId) outgoing.push(request);
    else incoming.push(request);
  }

  return { friends, incoming, outgoing, invites: await invitesFor(userId, origin) };
}

/* Invites still worth showing. A link that has been taken, cancelled or has
   run out is spent, and the answer is read off the link itself rather than off
   a status on the invite: two copies of "is this still open" is one copy that
   goes wrong. */
async function invitesFor(userId: string, origin: string): Promise<InviteView[]> {
  const rows = await getFriendInvitesFor(userId);
  const out: InviteView[] = [];
  for (const row of rows) {
    if (row.linkStatus === null || row.linkExpiresAt === null) continue; // the link has gone
    /* Whether it is still worth showing is the link's own derivation, called
       here rather than copied: the column is the only cast, and it is a cast
       of a text column whose values are exactly that union. */
    const state =
      row.kind === 'challenge'
        ? challengeStatusOf({ status: row.linkStatus as ChallengeRow['status'], expiresAt: row.linkExpiresAt })
        : homeGameStatusOf({ status: row.linkStatus as HomeGameRow['status'], expiresAt: row.linkExpiresAt });
    if (state !== 'open') continue;
    const from = await getUserById(row.fromId);
    if (!from) continue;
    out.push({
      id: row.linkId,
      kind: row.kind,
      url: inviteUrl(origin, row.kind, row.linkId),
      from: toUserSummary(from, await getRatingsFor(from.id)),
      expiresAt: row.linkExpiresAt.getTime(),
    });
  }
  return out;
}

function inviteUrl(origin: string, kind: InviteKind, linkId: string): string {
  return `${origin}/${kind === 'home' ? 'g' : 'c'}/${linkId}`;
}

export async function playedWith(userId: string, limit = 20): Promise<PlayedPersonView[]> {
  const rows = await getPlayedOpponents(userId, limit);
  const edges = await getFriendEdges(userId);
  return rows.map((row) => {
    const edge = edges.find((e) => e.otherId === row.id);
    const status: PlayedPersonView['status'] = !edge
      ? 'none'
      : edge.status === 'accepted'
        ? 'friends'
        : edge.requesterId === userId
          ? 'outgoing'
          : 'incoming';
    return {
      id: row.id,
      name: row.name,
      country: row.country,
      avatarV: row.avatarV,
      lastPlayedAt: row.lastPlayedAt.toISOString(),
      status,
    };
  });
}

// ---- the state machine ----

/* Both ends have to be a person with a name they chose. Answers the refusal
   or null, so every door asks it the same way and in the same order: who you
   are first, because a guest pressing Add should be told to claim rather than
   told the name they typed is a guest. */
async function refuseUnlessBothClaimed(
  userId: string,
  otherId: string
): Promise<Refusal | null> {
  const me = await getUserById(userId);
  if (!me) return { ok: false, status: 404, error: 'No such user' };
  if (me.guest) return { ok: false, status: 403, error: CLAIM_NEEDED };
  if (userId === otherId) return { ok: false, status: 400, error: 'That is you' };
  const them = await getUserById(otherId);
  if (!them) return { ok: false, status: 404, error: 'No such player' };
  if (them.bot) return { ok: false, status: 400, error: 'Bots do not have friends' };
  if (them.guest) {
    return {
      ok: false,
      status: 400,
      error: `${them.name} is playing as a guest. Friends need a claimed account on both sides.`,
    };
  }
  return null;
}

export interface RequestResult {
  ok: true;
  // Which of the two things happened: an ask, or the accept that an ask
  // crossing theirs turns into.
  state: 'requested' | 'accepted';
}

/* Asking, by name, because that is what somebody has: a name they were told
   at a table or read off a profile. An ask to somebody who has already asked
   you is the accept instead of a second row, which is what the unique index
   on the unordered pair makes the only possible reading of it. */
export async function requestFriendByName(
  userId: string,
  rawName: unknown
): Promise<RequestResult | Refusal> {
  const name = typeof rawName === 'string' ? rawName.trim() : '';
  if (!name) return { ok: false, status: 400, error: 'Type the name of the player you want to add' };
  const them = await getUserByNameLower(name.toLowerCase());
  if (!them) return { ok: false, status: 404, error: `Nobody here is called ${name}` };
  return requestFriend(userId, them.id);
}

export async function requestFriend(userId: string, otherId: string): Promise<RequestResult | Refusal> {
  const refusal = await refuseUnlessBothClaimed(userId, otherId);
  if (refusal) return refusal;

  const existing = await getFriendship(userId, otherId);
  if (existing?.status === 'accepted') {
    return { ok: false, status: 409, error: 'You are already friends' };
  }
  // They asked first, so this press is the answer to their request rather
  // than a second one pointing the other way.
  if (existing && existing.requesterId === otherId) return accept(userId, otherId);
  // Asking again is not an error: the control says "request sent" either way,
  // and telling somebody off for pressing it twice would be about nothing.
  if (existing) return { ok: true, state: 'requested' };

  const friends = await countFriends(userId);
  if (friends >= MAX_FRIENDS) {
    return {
      ok: false,
      status: 429,
      error: `You have ${MAX_FRIENDS} friends, which is the most this list holds. Remove one to add another.`,
    };
  }
  const waiting = await countOutgoingRequests(userId);
  if (waiting >= MAX_OPEN_OUTGOING) {
    return {
      ok: false,
      status: 429,
      error: `You have ${MAX_OPEN_OUTGOING} requests waiting to be answered. Wait for one of those first.`,
    };
  }

  const row = await insertFriendRequest(userId, otherId);
  // The row that beat this one to it is theirs, and the answer to theirs is
  // yes: two people pressing Add on each other is two people who want to be
  // friends, so it settles as accepted rather than as an error.
  if (!row) return accept(userId, otherId);

  push([userId, otherId], 'request');
  return { ok: true, state: 'requested' };
}

/* Yes. Only the person who was asked can say it, which is in the update's own
   where clause rather than checked here, so two tabs cannot both accept. */
export async function acceptFriend(userId: string, otherId: string): Promise<RequestResult | Refusal> {
  const refusal = await refuseUnlessBothClaimed(userId, otherId);
  if (refusal) return refusal;
  return accept(userId, otherId);
}

async function accept(userId: string, otherId: string): Promise<RequestResult | Refusal> {
  const friends = await countFriends(userId);
  if (friends >= MAX_FRIENDS) {
    return {
      ok: false,
      status: 429,
      error: `You have ${MAX_FRIENDS} friends, which is the most this list holds. Remove one to accept another.`,
    };
  }
  const row = await acceptFriendRequest(otherId, userId);
  if (!row) {
    const now = await getFriendship(userId, otherId);
    if (now?.status === 'accepted') return { ok: true, state: 'accepted' }; // somebody's other tab
    return { ok: false, status: 404, error: 'That request is no longer waiting' };
  }
  push([userId, otherId], 'accepted');
  return { ok: true, state: 'accepted' };
}

/* One control and one route for three things, because the row is what says
   which of them this is: a pending row you sent is a cancel, a pending row you
   were sent is a decline, an accepted row is an unfriend. Nothing about the
   answer differs, so nothing about the request does either. */
export async function removeFriend(userId: string, otherId: string): Promise<{ ok: true } | Refusal> {
  const row = await deleteFriendship(userId, otherId);
  await deleteFriendInvitesBetween(userId, otherId);
  if (!row) return { ok: false, status: 404, error: 'You are not friends with that player' };
  push([userId, otherId], 'removed');
  return { ok: true };
}

// ---- invites ----

export interface InviteRequest {
  kind?: unknown;
  mode?: unknown;
  rated?: unknown;
  speed?: unknown;
  botLevel?: unknown;
}

export interface InviteResult {
  ok: true;
  kind: InviteKind;
  id: string;
  url: string;
}

/* Making somebody a table. The link is made by the code that owns links, so
   the format, the caps, the expiry and the accept flow are all the ones this
   site already had; the only thing this adds is a row saying who it is for and
   a push telling them, so a friend does not have to be sent a URL in another
   app to play.

   A home invite reuses the lobby the host already has open rather than opening
   a fourth one: a host inviting three friends in a row is gathering one table.
   That is also what keeps this inside the three-lobbies-per-host cap without
   knowing the number. */
export async function inviteFriend(
  userId: string,
  otherId: string,
  body: InviteRequest,
  origin: string
): Promise<InviteResult | Refusal> {
  const refusal = await refuseUnlessBothClaimed(userId, otherId);
  if (refusal) return refusal;
  const edge = await getFriendship(userId, otherId);
  if (edge?.status !== 'accepted') {
    return { ok: false, status: 403, error: 'You can only invite a friend to a table' };
  }

  const kind: InviteKind = body.kind === 'home' ? 'home' : 'challenge';
  const rated = body.rated !== false;
  const link =
    kind === 'home'
      ? await homeLink(userId, rated, body.botLevel)
      : await challengeLink(userId, rated, body.speed);
  if ('ok' in link) return link;
  const linkId = link.id;

  await insertFriendInvite(otherId, userId, kind, linkId);

  const from = await getUserById(userId);
  const url = inviteUrl(origin, kind, linkId);
  if (from) {
    /* Told over the socket they already have open, wherever they are on the
       site. Somebody whose socket is shut simply misses it and reads the same
       invite off the friends page and the home card, which is why a dismissed
       toast is not a lost table. */
    hub.send(otherId, {
      t: 'invite',
      id: linkId,
      from: toUserSummary(from, await getRatingsFor(from.id)),
      kind,
      url,
      expiresAt: link.expiresAt.getTime(),
    });
  }
  return { ok: true, kind, id: linkId, url };
}

type Link = { id: string; expiresAt: Date };

async function challengeLink(userId: string, rated: boolean, rawSpeed: unknown): Promise<Link | Refusal> {
  // Heads-up, because that is what a challenge link is: `createChallenge`
  // refuses anything else and the refusal is its to make, not this file's.
  const made = await createChallenge(userId, 'heads-up', rated, challengeSpeed(rawSpeed));
  if (!made.ok) return made;
  return { id: made.row.id, expiresAt: made.row.expiresAt };
}

async function homeLink(userId: string, rated: boolean, rawLevel: unknown): Promise<Link | Refusal> {
  const open = await getOpenHomeGameForHost(userId);
  if (open) return { id: open.id, expiresAt: open.expiresAt };
  const level = isBotLevel(Number(rawLevel)) ? Number(rawLevel) : DEFAULT_BOT_LEVEL;
  const made = await createHomeGame(userId, rated, level);
  if (!made.ok) return made;
  return { id: made.row.id, expiresAt: made.row.expiresAt };
}

// ---- presence ----

/* Who has been told this person is here. A second tab must not push a second
   `online` at everybody's friends list, and a reload must not push an
   `offline` followed by an `online`, so the state of the announcement is kept
   rather than derived from whichever socket event just happened. */
const announcedOnline = new Set<string>();
const offlineTimers = new Map<string, NodeJS.Timeout>();

export function friendsOnConnect(userId: string): void {
  const pending = offlineTimers.get(userId);
  if (pending) {
    // They never went, as far as their friends are concerned: this is the
    // second half of a reload, and the push that would have said so is
    // cancelled rather than followed by its own correction.
    clearTimeout(pending);
    offlineTimers.delete(userId);
    announcedOnline.add(userId);
    return;
  }
  if (announcedOnline.has(userId)) return; // another tab, already announced
  announcedOnline.add(userId);
  void tellFriends(userId, 'online');
}

export function friendsOnDisconnect(userId: string): void {
  if (!announcedOnline.has(userId)) return;
  const pending = offlineTimers.get(userId);
  if (pending) clearTimeout(pending);
  const timer = setTimeout(() => {
    offlineTimers.delete(userId);
    // Asked again on the way out: a socket that came back after the timer was
    // set but before it fired is somebody who is still here.
    if (hub.isConnected(userId)) return;
    announcedOnline.delete(userId);
    void tellFriends(userId, 'offline');
  }, offlineDebounceMs);
  // Nothing in the process should be kept alive by a presence debounce.
  timer.unref?.();
  offlineTimers.set(userId, timer);
}

/* Process state, like the ready check's pending checks: a restart drops every
   pending offline push, which is correct, because a restart drops every socket
   with it and the next connect announces afresh. The seam is for a test file
   not to leave a timer behind for the next one. */
export function resetFriendPresence(): void {
  for (const timer of offlineTimers.values()) clearTimeout(timer);
  offlineTimers.clear();
  announcedOnline.clear();
}

/* Nothing throws out of a presence change: it is background work on the same
   footing as an arena tick, and a friends list that failed to update is not a
   reason for a socket to fall over. */
async function tellFriends(userId: string, kind: FriendEvent): Promise<void> {
  try {
    const ids = await getAcceptedFriendIds(userId);
    for (const id of ids) hub.send(id, { t: 'friend', kind });
  } catch {
    /* the next push, or the page's own refetch, settles it */
  }
}

function push(userIds: string[], kind: FriendEvent): void {
  for (const id of userIds) hub.send(id, { t: 'friend', kind });
}
