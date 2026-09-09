import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { formatFor, type MatchFormat, type Mode } from '@opentable/protocol';
import {
  makeApp,
  mintGuestSession,
  deleteUser,
  listenForWs,
  connectSession,
  testFormat,
  type Connected,
  type Session,
} from './helpers.js';
import { createMatchForPlayers, setFormatResolver } from '../src/matchmaking.js';
import { sql } from '../src/db.js';
import {
  MAX_FRIENDS,
  MAX_OPEN_OUTGOING,
  configureFriends,
  resetFriendPresence,
} from '../src/friends.js';

/* Friends, presence and invites. Nothing here waits on the matchmaking tick:
   a friend request is a row and an invite is a link, and the one match this
   file opens is opened directly through `createMatchForPlayers` so that
   "playing" has something to report.

   Every account here is claimed, because that is the rule the feature is
   built on, and the two that are not are the two refusals it owes. Names are
   suffixed so a file running beside this one cannot collide with it. */

const tag = randomBytes(3).toString('hex');
let counter = 0;

/* A long clock on purpose: the one live match this file makes is made to be
   looked at rather than played, so nothing in it should time out and finish
   while the assertions are being made. */
const FAST: Record<Mode, MatchFormat> = {
  'heads-up': testFormat({ hands: 1, stack: 20, clockMs: 60_000, graceMs: 60_000 }),
  'six-max': testFormat({ mode: 'six-max', stack: 12, clockMs: 60_000, graceMs: 60_000 }),
};

describe('friends', () => {
  let app: FastifyInstance;
  let wsUrl: string;
  const userIds: string[] = [];
  const matchIds: string[] = [];
  const sockets: Connected[] = [];

  beforeAll(async () => {
    app = await makeApp();
    wsUrl = await listenForWs(app);
    // The speed is passed through, not dropped: an invite names one and the
    // point of it reaching the table is what this file has to be able to see.
    setFormatResolver((mode, rated, speed) => ({ ...FAST[mode], rated, speed }));
    // Nobody should wait five real seconds to watch somebody go offline.
    configureFriends({ offlineDebounceMs: 40 });
  });

  afterAll(async () => {
    for (const conn of sockets) conn.ws.close();
    setFormatResolver(formatFor);
    resetFriendPresence();
    configureFriends({ offlineDebounceMs: 5_000 });
    for (const id of matchIds) await sql`delete from matches where id = ${id}`;
    for (const id of userIds) await deleteUser(id);
    await app.close();
  });

  function auth(session: Session) {
    return { cookie: `ot_session=${session.token}` };
  }

  async function guest(): Promise<Session> {
    const session = await mintGuestSession(app);
    userIds.push(session.id);
    return session;
  }

  /* A claimed account through the door a player uses: mint a guest and claim
     it, so the `guest` column is false for the reason production would make
     it false. */
  async function player(): Promise<Session> {
    const session = await guest();
    const name = `Fr${tag}${(counter += 1)}`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/claim',
      headers: auth(session),
      payload: { name, password: 'friends-are-good' },
    });
    expect(res.statusCode).toBe(200);
    return { ...session, name };
  }

  // Rows rather than sessions, for the two caps: two hundred accounts through
  // the claim route is four hundred requests to prove one comparison.
  async function bulkPlayers(n: number): Promise<string[]> {
    const rows = Array.from({ length: n }, () => {
      const name = `Bulk${tag}${(counter += 1)}`;
      return { name, name_lower: name.toLowerCase(), guest: false, password_hash: 'x' };
    });
    const made = await sql<{ id: string }[]>`
      insert into users ${sql(rows, 'name', 'name_lower', 'guest', 'password_hash')} returning id
    `;
    const ids = made.map((r) => r.id);
    userIds.push(...ids);
    return ids;
  }

  async function connect(session: Session): Promise<Connected> {
    const conn = await connectSession(wsUrl, session);
    await conn.messages.wait((m) => m.t === 'hi');
    sockets.push(conn);
    return conn;
  }

  const friends = (session: Session) =>
    app.inject({ method: 'GET', url: '/api/friends', headers: auth(session) });
  const request = (session: Session, name: string) =>
    app.inject({ method: 'POST', url: '/api/friends/request', headers: auth(session), payload: { name } });
  const acceptFriend = (session: Session, id: string) =>
    app.inject({ method: 'POST', url: `/api/friends/${id}/accept`, headers: auth(session) });
  const remove = (session: Session, id: string) =>
    app.inject({ method: 'DELETE', url: `/api/friends/${id}`, headers: auth(session) });
  const invite = (session: Session, id: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: `/api/friends/${id}/invite`, headers: auth(session), payload });

  it('asks by name, shows the request at both ends, and settles on accept', async () => {
    const alice = await player();
    const bob = await player();

    const asked = await request(alice, bob.name);
    expect(asked.statusCode).toBe(200);
    expect(asked.json().state).toBe('requested');

    const hers = (await friends(alice)).json();
    expect(hers.outgoing.map((r: { name: string }) => r.name)).toEqual([bob.name]);
    expect(hers.incoming).toEqual([]);
    expect(hers.friends).toEqual([]);

    const his = (await friends(bob)).json();
    expect(his.incoming.map((r: { name: string }) => r.name)).toEqual([alice.name]);
    // The rating on a request is for the mode that player actually plays,
    // with the mode beside it, so a number never turns up on its own.
    expect(his.incoming[0].rating).toBe(1500);
    // Nobody has played anything, and `mainMode` reads that as heads-up.
    expect(his.incoming[0].mode).toBe('heads-up');
    expect(his.outgoing).toEqual([]);

    const accepted = await acceptFriend(bob, alice.id);
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().state).toBe('accepted');

    for (const [who, other] of [
      [alice, bob],
      [bob, alice],
    ] as const) {
      const view = (await friends(who)).json();
      expect(view.friends.map((f: { name: string }) => f.name)).toEqual([other.name]);
      expect(view.incoming).toEqual([]);
      expect(view.outgoing).toEqual([]);
    }
  });

  it('accepts instead of asking when the other player asked first', async () => {
    const alice = await player();
    const bob = await player();
    expect((await request(alice, bob.name)).statusCode).toBe(200);

    const crossed = await request(bob, alice.name);
    expect(crossed.statusCode).toBe(200);
    expect(crossed.json().state).toBe('accepted');
    expect((await friends(bob)).json().friends).toHaveLength(1);
  });

  it('is idempotent about asking twice and refuses asking a friend', async () => {
    const alice = await player();
    const bob = await player();
    expect((await request(alice, bob.name)).json().state).toBe('requested');
    expect((await request(alice, bob.name)).json().state).toBe('requested');
    expect((await friends(bob)).json().incoming).toHaveLength(1);

    await acceptFriend(bob, alice.id);
    const again = await request(alice, bob.name);
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toContain('already friends');
  });

  it('declines by deleting the row, and the asker can ask again', async () => {
    const alice = await player();
    const bob = await player();
    await request(alice, bob.name);

    expect((await remove(bob, alice.id)).statusCode).toBe(200);
    expect((await friends(bob)).json().incoming).toEqual([]);
    expect((await friends(alice)).json().outgoing).toEqual([]);

    // Nothing was written that says "declined", so asking again is open.
    expect((await request(alice, bob.name)).json().state).toBe('requested');
  });

  it('cancels an outgoing request from the end that sent it', async () => {
    const alice = await player();
    const bob = await player();
    await request(alice, bob.name);
    expect((await remove(alice, bob.id)).statusCode).toBe(200);
    expect((await friends(bob)).json().incoming).toEqual([]);
  });

  it('unfriends from either end', async () => {
    const alice = await player();
    const bob = await player();
    await request(alice, bob.name);
    await acceptFriend(bob, alice.id);

    expect((await remove(alice, bob.id)).statusCode).toBe(200);
    expect((await friends(alice)).json().friends).toEqual([]);
    expect((await friends(bob)).json().friends).toEqual([]);

    const gone = await remove(alice, bob.id);
    expect(gone.statusCode).toBe(404);
  });

  it('refuses a guest on either side, and refuses a bot', async () => {
    const alice = await player();
    const wanderer = await guest();

    // A guest asking: told to claim rather than told about the other player.
    const asking = await app.inject({
      method: 'POST',
      url: '/api/friends/request',
      headers: auth(wanderer),
      payload: { name: alice.name },
    });
    expect(asking.statusCode).toBe(403);
    expect(asking.json().error).toContain('claimed account');

    // A guest being asked: refused by name, since the name is real.
    const asked = await request(alice, wanderer.name);
    expect(asked.statusCode).toBe(400);
    expect(asked.json().error).toContain('guest');

    const [bot] = await sql<{ id: string; name: string }[]>`
      select id, name from users where bot = true limit 1
    `;
    expect(bot).toBeDefined();
    const atBot = await request(alice, bot.name);
    expect(atBot.statusCode).toBe(400);
    expect(atBot.json().error).toContain('Bots');
  });

  it('refuses yourself and a name nobody has', async () => {
    const alice = await player();
    const self = await request(alice, alice.name);
    expect(self.statusCode).toBe(400);
    expect(self.json().error).toBe('That is you');

    const nobody = await request(alice, `Nobody${tag}`);
    expect(nobody.statusCode).toBe(404);
  });

  it(`stops at ${MAX_FRIENDS} friends`, async () => {
    const alice = await player();
    const others = await bulkPlayers(MAX_FRIENDS);
    await sql`
      insert into friendships ${sql(
        others.map((id) => ({ requester_id: alice.id, addressee_id: id, status: 'accepted' })),
        'requester_id',
        'addressee_id',
        'status'
      )}
    `;
    const bob = await player();
    const capped = await request(alice, bob.name);
    expect(capped.statusCode).toBe(429);
    expect(capped.json().error).toContain(String(MAX_FRIENDS));

    // The other end of a full list is still allowed to ask, so a cap is
    // about the person who has one rather than about the pair.
    expect((await request(bob, alice.name)).statusCode).toBe(200);
    // And the full list cannot accept it either.
    const accepting = await acceptFriend(alice, bob.id);
    expect(accepting.statusCode).toBe(429);
  });

  it(`stops at ${MAX_OPEN_OUTGOING} requests waiting to be answered`, async () => {
    const alice = await player();
    const others = await bulkPlayers(MAX_OPEN_OUTGOING);
    await sql`
      insert into friendships ${sql(
        others.map((id) => ({ requester_id: alice.id, addressee_id: id, status: 'pending' })),
        'requester_id',
        'addressee_id',
        'status'
      )}
    `;
    const bob = await player();
    const capped = await request(alice, bob.name);
    expect(capped.statusCode).toBe(429);
    expect(capped.json().error).toContain(String(MAX_OPEN_OUTGOING));

    // An answered request is not a waiting one: accepting one makes room.
    await sql`
      update friendships set status = 'accepted', responded_at = now()
      where requester_id = ${alice.id} and addressee_id = ${others[0]}
    `;
    expect((await request(alice, bob.name)).statusCode).toBe(200);
  });

  it('reports a friend as online while their socket is open, and the table they are at', async () => {
    const alice = await player();
    const bob = await player();
    await request(alice, bob.name);
    await acceptFriend(bob, alice.id);

    // Nobody connected: known, but not here.
    const cold = (await friends(alice)).json();
    expect(cold.friends[0].online).toBe(false);
    expect(cold.friends[0].playing).toBeNull();
    expect(typeof cold.friends[0].lastSeenAt).toBe('string');

    await connect(bob);
    const warm = (await friends(alice)).json();
    expect(warm.friends[0].online).toBe(true);
    expect(warm.friends[0].playing).toBeNull();

    const carol = await player();
    const matchId = await createMatchForPlayers([bob.id, carol.id], FAST['heads-up']);
    matchIds.push(matchId);
    const playing = (await friends(alice)).json();
    expect(playing.friends[0].playing).toBe(matchId);
  });

  it('pushes a friend message to both parties on a request, an accept and a removal', async () => {
    const alice = await player();
    const bob = await player();
    const a = await connect(alice);
    const b = await connect(bob);

    await request(alice, bob.name);
    expect((await a.messages.wait((m) => m.t === 'friend')).kind).toBe('request');
    expect((await b.messages.wait((m) => m.t === 'friend')).kind).toBe('request');

    await acceptFriend(bob, alice.id);
    expect((await a.messages.wait((m) => m.t === 'friend')).kind).toBe('accepted');
    expect((await b.messages.wait((m) => m.t === 'friend')).kind).toBe('accepted');

    await remove(alice, bob.id);
    expect((await a.messages.wait((m) => m.t === 'friend')).kind).toBe('removed');
    expect((await b.messages.wait((m) => m.t === 'friend')).kind).toBe('removed');
  });

  it('tells a friend when somebody arrives, and after the debounce when they go', async () => {
    const alice = await player();
    const bob = await player();
    await request(alice, bob.name);
    await acceptFriend(bob, alice.id);

    const a = await connect(alice);
    const b = await connect(bob);
    // Alice was already connected when Bob's socket opened, so hers is the
    // one that hears about it.
    expect((await a.messages.wait((m) => m.t === 'friend' && m.kind === 'online')).kind).toBe('online');

    b.ws.close();
    const gone = await a.messages.wait((m) => m.t === 'friend' && m.kind === 'offline', 3000);
    expect(gone.kind).toBe('offline');
  });

  it('invites a friend to a challenge link, pushes it, and lists it until it is spent', async () => {
    const alice = await player();
    const bob = await player();
    await request(alice, bob.name);
    await acceptFriend(bob, alice.id);
    const b = await connect(bob);

    const made = await invite(alice, bob.id, { kind: 'challenge', rated: false, speed: 'fast' });
    expect(made.statusCode).toBe(200);
    const { id, url, kind } = made.json() as { id: string; url: string; kind: string };
    expect(kind).toBe('challenge');
    expect(url.endsWith(`/c/${id}`)).toBe(true);

    const pushed = await b.messages.wait((m) => m.t === 'invite');
    expect(pushed.id).toBe(id);
    expect(pushed.kind).toBe('challenge');
    expect(pushed.url).toBe(url);
    expect(pushed.from.name).toBe(alice.name);
    expect(pushed.expiresAt).toBeGreaterThan(Date.now());

    // The link is an ordinary challenge link: it says what it will deal,
    // including the speed the invite asked for.
    const link = (await app.inject({ method: 'GET', url: `/api/challenges/${id}` })).json();
    expect(link.status).toBe('open');
    expect(link.rated).toBe(false);
    expect(link.speed).toBe('fast');
    expect(link.creator.name).toBe(alice.name);

    const listed = (await friends(bob)).json();
    expect(listed.invites).toHaveLength(1);
    expect(listed.invites[0].id).toBe(id);
    expect(listed.invites[0].url).toBe(url);
    expect(listed.invites[0].from.name).toBe(alice.name);

    // Spent means gone from the list, and the link is the only thing that
    // decides it: cancelling the challenge empties the invites.
    await app.inject({ method: 'DELETE', url: `/api/challenges/${id}`, headers: auth(alice) });
    expect((await friends(bob)).json().invites).toEqual([]);
  });

  it('deals the invited speed when the link is taken', async () => {
    const alice = await player();
    const bob = await player();
    await request(alice, bob.name);
    await acceptFriend(bob, alice.id);

    const { id } = (await invite(alice, bob.id, { kind: 'challenge', rated: false, speed: 'fast' })).json();
    const taken = await app.inject({
      method: 'POST',
      url: `/api/challenges/${id}/accept`,
      headers: auth(bob),
    });
    expect(taken.statusCode).toBe(200);
    const { matchId } = taken.json() as { matchId: string };
    matchIds.push(matchId);
    const match = (await app.inject({ method: 'GET', url: `/api/matches/${matchId}` })).json();
    expect(match.format.speed).toBe('fast');
  });

  it('reuses the lobby a host already has open for a home invite', async () => {
    const alice = await player();
    const bob = await player();
    const carol = await player();
    for (const other of [bob, carol]) {
      await request(alice, other.name);
      await acceptFriend(other, alice.id);
    }

    const first = (await invite(alice, bob.id, { kind: 'home' })).json() as { id: string; kind: string };
    expect(first.kind).toBe('home');
    const second = (await invite(alice, carol.id, { kind: 'home' })).json() as { id: string };
    // One table, two invitations to it: a host inviting two friends is
    // gathering one game and not opening two lobbies.
    expect(second.id).toBe(first.id);

    for (const other of [bob, carol]) {
      const view = (await friends(other)).json();
      expect(view.invites.map((i: { id: string }) => i.id)).toEqual([first.id]);
      expect(view.invites[0].url.endsWith(`/g/${first.id}`)).toBe(true);
    }
  });

  it('refuses an invite to somebody who is not a friend', async () => {
    const alice = await player();
    const bob = await player();
    const refused = await invite(alice, bob.id, { kind: 'challenge' });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toContain('friend');

    // A request in flight is not a friendship either.
    await request(alice, bob.name);
    expect((await invite(alice, bob.id, { kind: 'challenge' })).statusCode).toBe(403);
  });

  it('drops the invites between two people when they stop being friends', async () => {
    const alice = await player();
    const bob = await player();
    await request(alice, bob.name);
    await acceptFriend(bob, alice.id);
    await invite(alice, bob.id, { kind: 'challenge' });
    expect((await friends(bob)).json().invites).toHaveLength(1);

    await remove(bob, alice.id);
    expect((await friends(bob)).json().invites).toEqual([]);
  });

  it('lists the people you have played, newest table first, with where you stand', async () => {
    const alice = await player();
    const bob = await player();
    const carol = await player();

    const older = await createMatchForPlayers([alice.id, bob.id], FAST['heads-up']);
    matchIds.push(older);
    const newer = await createMatchForPlayers([alice.id, carol.id], FAST['heads-up']);
    matchIds.push(newer);

    const played = (await app.inject({
      method: 'GET',
      url: '/api/friends/played',
      headers: auth(alice),
    })).json() as { name: string; status: string }[];
    expect(played.map((p) => p.name)).toEqual([carol.name, bob.name]);
    expect(played.every((p) => p.status === 'none')).toBe(true);

    await request(alice, bob.name);
    const after = (await app.inject({
      method: 'GET',
      url: '/api/friends/played',
      headers: auth(alice),
    })).json() as { name: string; status: string }[];
    expect(after.find((p) => p.name === bob.name)?.status).toBe('outgoing');
  });
});
