import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BOT_LEVELS, botLevelInfo, formatFor } from '@opentable/protocol';
import type { Mode } from '@opentable/protocol';
import { api, ApiError } from '../net/api.ts';
import { levelAverageRating, modeRating, avatarVersion } from '../net/adapt.ts';
import type { ArenaListing, BotRow, CreatedChallenge, LeaderboardRow, Me } from '../net/types.ts';
import { readPlayChoice, useSession } from '../net/session.tsx';
import { MODES, MODE_NAME } from '../ui/mode-tabs.tsx';
import { elapsed, useNow } from '../ui/bits.tsx';
import { arenaCardLine } from './arena-bits.ts';
import { int } from '../ui/format.ts';
import { useTitle } from '../ui/title.ts';
import { Link, useLocation } from 'react-router-dom';
import { Avatar } from '../ui/avatar.tsx';
import { avatarSeed } from '../net/adapt.ts';
import { RecentMatches, StatsStrip } from './feed.tsx';
import { ShareLink } from '../ui/share-link.tsx';

/* The line under each mode's name is built from that mode's format, so the
   promise on the card cannot drift from the match it starts. Exported because
   a challenge link promises the same match on a different page. */
export function modeBlurb(mode: Mode): string {
  const f = formatFor(mode, true);
  if (mode === 'six-max') {
    return `Last player standing. ${f.players} seats, ${f.stack} units each, blinds climb every ${f.levelHands} hands.`;
  }
  return `Best of ${f.hands} hands. ${f.stack} units each, blinds fixed at ${f.sb} and ${f.bb}.`;
}

export function Home() {
  const { me, queue, startQueue, startPractice, cancelQueue, offline, ready, conn, liveMatch, clearFound } = useSession();
  const nav = useNavigate();
  const searching = queue.s === 'searching';
  const { hash } = useLocation();
  useTitle(null);
  const now = useNow(searching, 250);

  /* The last choice reopens the picker where it was left: that mode's stake,
     and a quiet mark on the card that was played. */
  const [last] = useState(() => readPlayChoice());
  const [rated, setRated] = useState<Record<Mode, boolean>>(() => ({
    'heads-up': last?.mode === 'heads-up' ? last.rated : true,
    'six-max': last?.mode === 'six-max' ? last.rated : true,
  }));

  /* The found state is a one-shot ticket to the table. Clearing it once it
     has been used is what lets somebody come back to this page mid-match
     without being bounced straight to their table again. */
  useEffect(() => {
    if (queue.s === 'found' && queue.m) {
      const m = queue.m;
      clearFound();
      nav(`/m/${m}`);
    }
  }, [queue.s, queue.m, nav, clearFound]);

  useEffect(() => {
    if (hash) document.querySelector(hash)?.scrollIntoView({ block: 'start' });
  }, [hash]);

  const seats = formatFor(queue.mode, queue.rated).players;
  const searchingFor = queue.practice ? 'Dealing you in against the bots' : `Searching for a ${MODE_NAME[queue.mode].toLowerCase()} table`;

  return (
    <main className="page stack">
      <section className="hero">
        <h1 className="h1">Ranked hold'em</h1>
        <p className="lede">
          Heads-up or six handed, <b>no money anywhere</b>. Chips are table units that reset every
          match. The only thing you keep is your rating.
        </p>

        {offline && ready && (
          <div className="card" role="status">
            <div className="empty">
              <span className="e-title">The table server is not answering</span>
              <span className="e-desc">
                Matchmaking is unavailable until it is back. Reload to try the connection again.
              </span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => location.reload()}>
                Try again
              </button>
            </div>
          </div>
        )}

        {!searching ? (
          <div className="modes">
            {MODES.map((mode) => (
              <div className="card mode" key={mode} data-last={last?.mode === mode ? '' : undefined}>
                <div className="mode-head">
                  <span className="t">{MODE_NAME[mode]}</span>
                  {last?.mode === mode && <span className="muted">last played</span>}
                </div>
                <span className="muted">{modeBlurb(mode)}</span>
                {me && <YourRating mode={mode} me={me} />}
                <div className="stakes">
                  {[true, false].map((r) => (
                    <label className="choice" key={String(r)}>
                      <input
                        type="radio"
                        className="radio"
                        name={`stake-${mode}`}
                        checked={rated[mode] === r}
                        onChange={() => setRated((prev) => ({ ...prev, [mode]: r }))}
                      />
                      {r ? 'Rated' : 'Casual'}
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!ready || offline}
                  onClick={() => startQueue(mode, rated[mode])}
                >
                  Play
                </button>
              </div>
            ))}
            <PracticeCard onPlay={startPractice} disabled={!ready || offline} error={queue.error} />
            <ArenaCard />
            <FriendCard disabled={!ready || offline} />
          </div>
        ) : (
          <div className="card searching-card" role="status">
            <span className="t">{searchingFor}</span>
            <div className="searching">
              <span className="spinner" aria-hidden="true" />
              <span className="el num">{elapsed(now - queue.since)}</span>
              <span className="badge badge-plain">
                {queue.practice ? 'Practice' : queue.rated ? 'Rated' : 'Casual'}
              </span>
              {queue.mode === 'six-max' && queue.seated != null && (
                <span className="badge badge-plain num">{queue.seated} of {seats} seated</span>
              )}
              {queue.range != null && (
                <span className="badge badge-plain num">Within {queue.range} rating</span>
              )}
              {queue.w != null && queue.w > 0 && (
                <span className="badge badge-plain num">{queue.w} waiting</span>
              )}
              <button type="button" className="btn btn-tertiary btn-sm" onClick={cancelQueue}>
                Cancel search
              </button>
            </div>
          </div>
        )}

        <StatsStrip />

        {liveMatch && (
          <Link className="btn btn-secondary" to={`/m/${liveMatch}`}>
            Return to your match
          </Link>
        )}

        {!offline && conn === 'waiting' && (
          <span className="muted">Connection dropped. Reconnecting.</span>
        )}
      </section>

      <section className="how">
        <div className="card">
          <span className="k">1</span>
          <span className="t">No money, ever</span>
          <span className="muted">No buy-ins, no rake, no ads. Nothing to purchase.</span>
        </div>
        <div className="card">
          <span className="k">2</span>
          <span className="t">Chips reset every match</span>
          <span className="muted">Everyone starts on 200 units. Six-max blinds climb until one player has the lot.</span>
        </div>
        <div className="card">
          <span className="k">3</span>
          <span className="t">Rating is the score</span>
          <span className="muted">Glicko-2, updated once per match. That is the whole ladder.</span>
        </div>
      </section>

      <RecentMatches />

      <Leaderboard mode={queue.mode} />

      <footer className="home-foot">
        Every hand is <Link to="/learn/fair">provably fair</Link>. Every match is public.{' '}
        <Link to="/learn">Learn how to play</Link>
      </footer>
    </main>
  );
}

/* The third way to play: a table of bots at a level you pick, never rated.
   The card spans the picker's row because it is one card, not a mode of its
   own, and the level list reads better wide than squeezed into a column.

   The rating beside each level is the live average of the bots that play at
   it, in the mode chosen above, so the number is what those opponents have
   actually earned rather than a claim about the level. */
function PracticeCard({
  onPlay,
  disabled,
  error,
}: {
  onPlay: (mode: Mode, level: number) => void;
  disabled: boolean;
  error?: string;
}) {
  const [mode, setMode] = useState<Mode>('heads-up');
  const [level, setLevel] = useState(2);
  const [bots, setBots] = useState<BotRow[]>([]);

  useEffect(() => {
    let live = true;
    api
      .bots()
      .then((rows) => live && setBots(rows))
      .catch(() => {
        /* the picker still works; it just cannot show what the bots are rated */
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="card mode" style={{ gridColumn: '1 / -1' }}>
      <div className="mode-head">
        <span className="t">Practice against bots</span>
      </div>
      <span className="muted">
        Live equity and outs are shown at the table. Practice matches are never rated.
      </span>
      <div className="stakes">
        {MODES.map((m) => (
          <label className="choice" key={m}>
            <input
              type="radio"
              className="radio"
              name="practice-mode"
              checked={mode === m}
              onChange={() => setMode(m)}
            />
            {MODE_NAME[m]}
          </label>
        ))}
      </div>
      <label className="field">
        <span className="label">Level</span>
        <span className="select-wrap">
          <select
            className="select"
            value={level}
            onChange={(e) => setLevel(Number(e.target.value))}
            aria-label="Bot level"
          >
            {BOT_LEVELS.map((b) => {
              const avg = levelAverageRating(bots, b.level, mode);
              const form = avg == null ? 'no rated matches yet' : `rated ${avg}`;
              return (
                <option key={b.level} value={b.level}>
                  Level {b.level}, {b.name.toLowerCase()}, {form}
                </option>
              );
            })}
          </select>
        </span>
      </label>
      <span className="muted">{botLevelInfo(level).description}</span>
      {error && <span className="badge badge-warn">{error}</span>}
      <button type="button" className="btn btn-primary" disabled={disabled} onClick={() => onPlay(mode, level)}>
        Play against bots
      </button>
    </div>
  );
}

/* The fifth way to play: an event rather than a table. The card is a pointer
   at /arena and nothing more, because joining an arena is a thing you do on
   its own page beside the board you are joining.

   The line under the name is written by the same function the arena page's
   clock is, so the card and the page cannot describe the same arena
   differently. A card whose call failed simply says nothing about the time
   rather than showing a countdown it made up. */
function ArenaCard() {
  const [listing, setListing] = useState<ArenaListing | null>(null);
  const [failed, setFailed] = useState(false);
  const now = useNow(listing !== null, 1000);

  useEffect(() => {
    let live = true;
    api
      .arenas()
      .then((l) => live && setListing(l))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const featured = listing?.featured ?? null;

  return (
    <div className="card mode" style={{ gridColumn: '1 / -1' }}>
      <div className="mode-head">
        <span className="t">Hourly arena</span>
        {featured?.status === 'running' && <span className="badge badge-ok">Running</span>}
      </div>
      <span className="muted">
        {failed
          ? 'An arena runs every hour. Open the arena to see the next one.'
          : arenaCardLine(featured, now)}
      </span>
      <span className="muted">
        Half an hour of heads-up, paired again the moment your match ends. A win is worth two, a draw
        one, and a third win in a row is worth three.
      </span>
      <Link className="btn btn-primary" to={featured ? `/arena/${featured.id}` : '/arena'}>
        {featured?.status === 'running' ? 'Open the arena' : 'See the next arena'}
      </Link>
    </div>
  );
}

/* The fourth way to play: a link instead of a queue, in two sizes. A heads-up
   challenge seats exactly two people and starts itself the moment the second
   one accepts. A home game is the six-max version: one private table, one
   link, a lobby that friends gather in and a host who starts it, with the
   seats nobody took filled by bots at a level the host picks.

   A made link is remembered in this browser, because the link outlives the
   page: without this a reload would strand it, and the only way back would be
   to make another and spend one of the few allowed. */
const CHALLENGE_KEY = 'ot-challenge';

type LinkKind = 'challenge' | 'home';

interface SavedLink extends CreatedChallenge {
  kind: LinkKind;
}

/* A link saved before home games existed has no kind and is a challenge, which
   is why the field is read rather than required. */
function readChallenge(): SavedLink | null {
  try {
    const raw = localStorage.getItem(CHALLENGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<SavedLink>;
    if (!v?.id || !v?.url) return null;
    return { id: v.id, url: v.url, kind: v.kind === 'home' ? 'home' : 'challenge' };
  } catch {
    return null;
  }
}

function writeChallenge(c: SavedLink | null) {
  try {
    if (c) localStorage.setItem(CHALLENGE_KEY, JSON.stringify(c));
    else localStorage.removeItem(CHALLENGE_KEY);
  } catch {
    /* private mode: the link is still on screen, just not after a reload */
  }
}

const LINK_KINDS: { kind: LinkKind; label: string }[] = [
  { kind: 'challenge', label: 'Heads-up challenge' },
  { kind: 'home', label: 'Home game, up to six' },
];

function FriendCard({ disabled }: { disabled: boolean }) {
  const [kind, setKind] = useState<LinkKind>('challenge');
  const [rated, setRated] = useState(true);
  const [level, setLevel] = useState(2);
  const [link, setLink] = useState<SavedLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* A remembered link is only shown once the server says it is still waiting,
     the same bargain the remembered live match makes. Which of the two calls
     asks is the only thing the kind changes. */
  useEffect(() => {
    const saved = readChallenge();
    if (!saved) return;
    let live = true;
    const still =
      saved.kind === 'home'
        ? api.homeGame(saved.id).then((g) => g.status === 'open')
        : api.challenge(saved.id).then((c) => c.status === 'open');
    still
      .then((open) => {
        if (!live) return;
        if (open) setLink(saved);
        else writeChallenge(null);
      })
      .catch(() => writeChallenge(null));
    return () => {
      live = false;
    };
  }, []);

  const make = async () => {
    setBusy(true);
    setError(null);
    try {
      const made =
        kind === 'home' ? await api.createHomeGame(rated, level) : await api.createChallenge('heads-up', rated);
      const saved: SavedLink = { ...made, kind };
      writeChallenge(saved);
      setLink(saved);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'the link could not be made. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  /* The link leaves this page the moment it is cancelled: the request that
     spends it on the server is the tidy-up, and a failed one only means the
     link sits unused until it expires. */
  const drop = async () => {
    if (!link) return;
    const { id, kind: made } = link;
    writeChallenge(null);
    setLink(null);
    setError(null);
    try {
      if (made === 'home') await api.cancelHomeGame(id);
      else await api.cancelChallenge(id);
    } catch {
      /* it expires on its own within the day either way */
    }
  };

  return (
    <div className="card mode" style={{ gridColumn: '1 / -1' }}>
      <div className="mode-head">
        <span className="t">Play a friend</span>
      </div>
      <span className="muted">
        Make a link and send it to whoever you want to play. A heads-up challenge starts the moment
        they open it. A home game gathers up to six in a lobby and you start it.
      </span>

      {link ? (
        <>
          <ShareLink url={link.url} what={link.kind === 'home' ? 'table' : 'challenge'} />
          {link.kind === 'home' ? (
            <>
              <span className="muted">
                Your table is waiting. Open it to see who has arrived and start the game.
              </span>
              <Link className="btn btn-primary" to={`/g/${link.id}`}>Open your table</Link>
            </>
          ) : (
            <span className="muted">Waiting for your friend. The link works for 24 hours.</span>
          )}
          <button type="button" className="btn btn-tertiary btn-sm" onClick={drop}>
            Cancel link
          </button>
        </>
      ) : (
        <>
          <div className="stakes link-kinds">
            {LINK_KINDS.map((k) => (
              <label className="choice" key={k.kind}>
                <input
                  type="radio"
                  className="radio"
                  name="friend-kind"
                  checked={kind === k.kind}
                  onChange={() => setKind(k.kind)}
                />
                {k.label}
              </label>
            ))}
          </div>
          <div className="stakes">
            {[true, false].map((r) => (
              <label className="choice" key={String(r)}>
                <input
                  type="radio"
                  className="radio"
                  name="friend-stake"
                  checked={rated === r}
                  onChange={() => setRated(r)}
                />
                {r ? 'Rated' : 'Casual'}
              </label>
            ))}
          </div>
          {kind === 'home' && (
            <>
              <label className="field">
                <span className="label">Bots in the empty seats</span>
                <span className="select-wrap">
                  <select
                    className="select"
                    value={level}
                    onChange={(e) => setLevel(Number(e.target.value))}
                    aria-label="Bot level for the empty seats"
                  >
                    {BOT_LEVELS.map((b) => (
                      <option key={b.level} value={b.level}>
                        Level {b.level}, {b.name.toLowerCase()}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
              <span className="muted">
                A rated home game needs two people at it. One person and five bots plays casual.
              </span>
            </>
          )}
          {error && <span className="badge badge-warn">{error}</span>}
          <button type="button" className="btn btn-primary" disabled={disabled || busy} onClick={make}>
            Create a link
          </button>
        </>
      )}
    </div>
  );
}

/* Your standing in that mode, on the card that starts it. A mode you have
   never played says so rather than showing the 1500 everyone starts on as
   though it were earned. */
function YourRating({ mode, me }: { mode: Mode; me: Me }) {
  const r = modeRating(me, mode);
  if (r.matches === 0) return <span className="muted">No rated matches in this mode yet.</span>;
  return (
    <span className="tags muted">
      <span>
        Your rating <span className="num">{int(r.rating)}</span>
        <span className="rd num">+-{int(r.rd)}</span>
      </span>
      {r.provisional && <span className="badge badge-warn">Provisional</span>}
    </span>
  );
}

/* The peek follows the mode the picker is on, so the board underneath is the
   ladder the button above it plays for. */
function Leaderboard({ mode }: { mode: Mode }) {
  const [list, setList] = useState<LeaderboardRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setList(null);
    setFailed(false);
    api
      .leaderboard(mode)
      .then((p) => live && setList(p.slice(0, 10)))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [mode]);

  return (
    <section className="stack" id="leaderboard" style={{ gap: 'var(--sp-3)' }} data-enter-ready={list ? 'yes' : 'no'}>
      <div className="lb-head">
        <span className="h2">Top ten, {MODE_NAME[mode].toLowerCase()}</span>
        <span className="muted">Rating, with the deviation beside it</span>
        <span style={{ flex: 1 }} />
        <Link className="btn btn-tertiary btn-sm" to="/leaderboard">See all</Link>
      </div>
      <div className="card lb-card">
        {failed || (list && list.length === 0) ? (
          <div className="empty">
            <span className="e-title">No ratings yet</span>
            <span className="e-desc">The board fills in as rated matches finish.</span>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table" aria-label="Top rated players">
              <thead>
                <tr>
                  <th className="r" style={{ width: 34 }}>#</th>
                  <th>Player</th>
                  <th className="r">Rating</th>
                </tr>
              </thead>
              <tbody>
                {(list ?? placeholder).map((r, i) => (
                  <tr key={r.name || i}>
                    <td className="r">{i + 1}</td>
                    <td>
                      {list ? (
                        <span className="player-cell">
                          <Avatar
                            seed={avatarSeed(r.id, r.name)}
                            name={r.name}
                            size={24}
                            avatarV={avatarVersion(r.avatarV)}
                          />
                          <Link to={`/u/${encodeURIComponent(r.name)}`}>{r.name}</Link>
                        </span>
                      ) : (
                        <span className="skeleton skeleton-text" style={{ width: 96 }} />
                      )}
                    </td>
                    <td className="r">
                      {list ? (
                        <>
                          {int(r.rating)}
                          {r.rd != null && <span className="rd num">+-{int(r.rd)}</span>}
                        </>
                      ) : (
                        <span className="skeleton skeleton-text" style={{ width: 48 }} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

const placeholder: LeaderboardRow[] = Array.from({ length: 5 }, (_, i) => ({
  name: `row-${i}`,
  rating: 0,
  rd: 0,
  matches: 0,
  peak: 0,
}));
