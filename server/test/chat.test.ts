import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { MatchFormat } from '@opentable/protocol';
import { CHAT_MAX_LENGTH, CHAT_MAX_PER_MATCH, CHAT_MIN_GAP_MS } from '@opentable/protocol';
import {
  connectSession, deleteUser, listenForWs, makeApp, mintGuestSession, testFormat, type Connected,
} from './helpers.js';
import { createMatchForPlayers } from '../src/matchmaking.js';
import { ChatLimiter, cleanChatText, looksLikeLink } from '../src/chat.js';
import { sql } from '../src/db.js';

/* A long, slow format: this suite says nothing about poker and every hand it
   deals is one it never wants to finish. A 60s clock and a big stack keep the
   table sitting still while messages are sent across it. */
const SLOW: MatchFormat = testFormat({
  rated: false, stack: 500, clockMs: 60_000, graceMs: 60_000,
});

function chatWait(conn: Connected, timeoutMs = 3000) {
  return conn.messages.wait((m) => m.t === 'chat', timeoutMs);
}

function errWait(conn: Connected, timeoutMs = 3000) {
  return conn.messages.wait((m) => m.t === 'err' && m.c === 'chat', timeoutMs);
}

function say(conn: Connected, matchId: string, text: string) {
  conn.ws.send(JSON.stringify({ t: 'chat', m: matchId, text }));
}

/* Every socket a message was owed, drained. Draining matters as much as the
   assertion: a copy left in a queue is read by the next case as though it had
   just arrived, and the failure lands two tests away from the cause. */
async function hearAll(conns: Connected[], text: string) {
  for (const c of conns) expect((await chatWait(c)).text).toBe(text);
}

/* The pure half needs no table at all: the clock is a parameter, so twenty
   messages take no longer to test than one. */
describe('what a chat message has to be', () => {
  it('strips control characters and collapses the newlines a paste brings', () => {
    const clean = cleanChatText('nice\u0000 hand\n\nfriend\t');
    expect(clean.ok).toBe(true);
    expect(clean.text).toBe('nice hand friend');
  });

  it('refuses an empty message and one made only of control characters', () => {
    expect(cleanChatText('   ').reason).toBe('empty');
    expect(cleanChatText('\u0000\u0001').reason).toBe('empty');
    expect(cleanChatText(42).reason).toBe('empty');
  });

  it(`refuses more than ${CHAT_MAX_LENGTH} characters`, () => {
    expect(cleanChatText('a'.repeat(CHAT_MAX_LENGTH)).ok).toBe(true);
    expect(cleanChatText('a'.repeat(CHAT_MAX_LENGTH + 1)).reason).toBe('too_long');
  });

  it('reads a scheme, a bare host and a host inside a sentence as a link', () => {
    expect(looksLikeLink('https://example.com/x')).toBe(true);
    expect(looksLikeLink('come to example.com')).toBe(true);
    expect(looksLikeLink('ftp://files.org')).toBe(true);
    expect(cleanChatText('join my-site.io now').reason).toBe('link');
  });

  it('leaves ordinary writing alone, full stops included', () => {
    for (const text of ['Good game.', 'Nice hand. Unlucky on the river.', 'gg wp', 'A.J. suited']) {
      expect(looksLikeLink(text)).toBe(false);
    }
  });
});

describe('how often one person may send', () => {
  it('holds a gap between messages and reports how long is left', () => {
    const limiter = new ChatLimiter();
    expect(limiter.check('u', 0)).toBeNull();
    limiter.record('u', 0);
    expect(limiter.check('u', 500)).toBe('too_fast');
    expect(limiter.waitFor('u', 500)).toBe(1500);
    expect(limiter.check('u', 2000)).toBeNull();
    expect(limiter.waitFor('u', 2000)).toBe(0);
  });

  it(`stops at ${CHAT_MAX_PER_MATCH} for the life of the match`, () => {
    const limiter = new ChatLimiter();
    for (let i = 0; i < CHAT_MAX_PER_MATCH; i += 1) {
      const at = i * 2000;
      expect(limiter.check('u', at)).toBeNull();
      limiter.record('u', at);
    }
    expect(limiter.check('u', 10 * 60 * 1000)).toBe('too_many');
  });

  it('counts one allowance per person', () => {
    const limiter = new ChatLimiter();
    limiter.record('a', 0);
    expect(limiter.check('a', 100)).toBe('too_fast');
    expect(limiter.check('b', 100)).toBeNull();
  });
});

describe('chat at a table', () => {
  let app: FastifyInstance;
  let wsUrl: string;
  let matchId = '';
  const userIds: string[] = [];
  const sockets: Connected[] = [];

  let player: Connected;
  let opponent: Connected;
  let rail: Connected;
  let rail2: Connected;
  // Everybody a player's message reaches: both seats and the whole rail.
  let table: Connected[] = [];

  beforeAll(async () => {
    app = await makeApp();
    wsUrl = await listenForWs(app);

    const sessions = await Promise.all([
      mintGuestSession(app), mintGuestSession(app), mintGuestSession(app), mintGuestSession(app),
    ]);
    for (const s of sessions) userIds.push(s.id);
    [player, opponent, rail, rail2] = await Promise.all(sessions.map((s) => connectSession(wsUrl, s)));
    sockets.push(player, opponent, rail, rail2);
    table = [player, opponent, rail, rail2];
    for (const c of sockets) await c.messages.wait((m) => m.t === 'hi');

    matchId = await createMatchForPlayers([player.id, opponent.id], SLOW);
    for (const c of sockets) {
      c.ws.send(JSON.stringify({ t: 'join', m: matchId }));
      await c.messages.wait((m) => m.t === 'state');
    }
  });

  afterAll(async () => {
    for (const c of sockets) c.ws.close();
    if (matchId) {
      await sql`delete from chat where match_id = ${matchId}`;
      await sql`delete from matches where id = ${matchId}`;
    }
    for (const id of userIds) await deleteUser(id);
    await app.close();
  });

  /* The gap is asserted in the same case that spends the allowance, back to
     back: split across two cases it would depend on the first finishing inside
     two seconds, and a suite that passes because it was quick is not a suite. */
  it('sends a player message to both seats and the rail, then holds the gap', async () => {
    say(player, matchId, 'Good game');

    for (const c of table) {
      const msg = await chatWait(c);
      expect(msg.m).toBe(matchId);
      expect(msg.text).toBe('Good game');
      expect(msg.from.name).toBe(player.name);
      expect(msg.from.bot).toBe(false);
      expect(msg.from.seat).toBe(0);
      expect(typeof msg.at).toBe('number');
    }

    say(player, matchId, 'Nice hand');
    const err = await errWait(player);
    expect(err.msg).toMatch(/^Wait \ds before sending again\.$/);
  });

  it('refuses a message over the length before it charges anyone for it', async () => {
    say(opponent, matchId, 'x'.repeat(CHAT_MAX_LENGTH + 1));
    const err = await errWait(opponent);
    expect(err.msg).toBe(`Keep a message to ${CHAT_MAX_LENGTH} characters.`);

    // The refusal cost nothing: the very next message goes through.
    say(opponent, matchId, 'Thanks');
    await hearAll(table, 'Thanks');
  });

  it('refuses a link in the plainest possible words', async () => {
    say(rail2, matchId, 'watch me at example.com');
    const err = await errWait(rail2);
    expect(err.msg).toBe('Links are not allowed here');
  });

  it('keeps the rail talking to itself: a spectator line never reaches a seat', async () => {
    say(rail, matchId, 'Unlucky');
    for (const c of [rail, rail2]) {
      const heard = await chatWait(c);
      expect(heard.text).toBe('Unlucky');
      expect(heard.from.seat).toBeNull();
    }

    /* Proving the negative the way the hole-card test does: send a message
       the seats certainly do get, and assert it is the next one they see. A
       rail line that leaked would arrive first and fail here. The wait is the
       one real one in the suite: this is the only sender that speaks twice,
       and the gap it is subject to is the gap the case above proved. */
    await new Promise((r) => setTimeout(r, CHAT_MIN_GAP_MS));
    say(player, matchId, 'Well played');
    await hearAll(table, 'Well played');
  });

  it('replays the conversation on join, each side getting only its own channel', async () => {
    const late = await connectSession(wsUrl, { token: rail2.token, id: rail2.id, name: rail2.name });
    sockets.push(late);
    await late.messages.wait((m) => m.t === 'hi');
    late.ws.send(JSON.stringify({ t: 'join', m: matchId }));
    await late.messages.wait((m) => m.t === 'state');

    const seen: string[] = [];
    for (let i = 0; i < 4; i += 1) seen.push((await chatWait(late)).text);
    // A spectator is owed both channels, in the order they were said.
    expect(seen).toEqual(['Good game', 'Thanks', 'Unlucky', 'Well played']);

    const seated = await connectSession(wsUrl, { token: player.token, id: player.id, name: player.name });
    sockets.push(seated);
    await seated.messages.wait((m) => m.t === 'hi');
    seated.ws.send(JSON.stringify({ t: 'join', m: matchId }));
    await seated.messages.wait((m) => m.t === 'state');

    const atTable: string[] = [];
    for (let i = 0; i < 3; i += 1) atTable.push((await chatWait(seated)).text);
    expect(atTable).toEqual(['Good game', 'Thanks', 'Well played']);
  });

  it('stores every accepted message and nothing that was refused', async () => {
    const rows = await sql<{ text: string; seat: number | null }[]>`
      select text, seat from chat where match_id = ${matchId} order by at, id
    `;
    expect(rows.map((r) => r.text)).toEqual(['Good game', 'Thanks', 'Unlucky', 'Well played']);
    expect(rows.map((r) => r.seat)).toEqual([0, 1, null, 0]);
  });

  it('refuses chat from somebody who has not joined the table', async () => {
    const outsider = await connectSession(wsUrl, await mintGuestSession(app));
    sockets.push(outsider);
    userIds.push(outsider.id);
    await outsider.messages.wait((m) => m.t === 'hi');
    say(outsider, matchId, 'Hello');
    const err = await outsider.messages.wait((m) => m.t === 'err');
    expect(err.c).toBe('no_match');
  });
});
