import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  BOT_LEVELS, MODE_CHOICES, PRACTICE_PRESETS, SPEED_CHOICES, SPEED_NAME,
  ceilingFor, formatFor, modesFor, rankedBanText, speedOf,
} from '@opentable/protocol';
import type {
  MatchFormat, Mode, ModeChoice, PracticePreset, Speed, SpeedChoice,
} from '@opentable/protocol';
import { Cpu } from '@phosphor-icons/react/dist/icons/Cpu';
import { Eye } from '@phosphor-icons/react/dist/icons/Eye';
import { GraduationCap } from '@phosphor-icons/react/dist/icons/GraduationCap';
import { PuzzlePiece } from '@phosphor-icons/react/dist/icons/PuzzlePiece';
import { Lightning } from '@phosphor-icons/react/dist/icons/Lightning';
import { Trophy } from '@phosphor-icons/react/dist/icons/Trophy';
import { Link as LinkIcon } from '@phosphor-icons/react/dist/icons/Link';
import { UsersThree } from '@phosphor-icons/react/dist/icons/UsersThree';
import { api, ApiError } from '../net/api.ts';
import { avatarSeed, avatarVersion, mainModeOf, modeRating } from '../net/adapt.ts';
import type { ArenaListing, CreatedChallenge, LeaderboardRow, LiveMatch, Me } from '../net/types.ts';
import { readPlayChoice, useSession } from '../net/session.tsx';
import { MODE_NAME, modeInline, modeTabLabel, speedChoiceName } from '../ui/mode-tabs.tsx';
import { Segmented } from '../ui/segmented.tsx';
import { elapsed, useNow } from '../ui/bits.tsx';
import { arenaCardLine } from './arena-bits.ts';
import { int } from '../ui/format.ts';
import { useTitle } from '../ui/title.ts';
import { Avatar } from '../ui/avatar.tsx';
import { Flag, FlagSlot } from '../ui/flag.tsx';
import { LESSONS } from './learn/lessons.ts';
import { readPuzzles } from '../puzzles/store.ts';
import { RecentMatches, StatsStrip } from './feed.tsx';
import { ShareLink } from '../ui/share-link.tsx';

/* The same line for a search that has not named one game. A promise cannot be
   made from a format when two of them would do, so it says what is being
   looked for and leaves the shape to the table that turns up: the blurb's
   whole job is that it never disagrees with the match it starts. */
function choiceBlurb(mode: ModeChoice, speed: SpeedChoice): string {
  if (mode !== 'any' && speed !== 'any') return modeBlurb(mode, speed);
  const size = mode === 'any' ? 'Six handed or heads-up' : MODE_NAME[mode];
  const pace = speed === 'any' ? ' at either speed' : `, ${SPEED_NAME[speed].toLowerCase()},`;
  return `${size}${pace}. Whichever table fills first.`;
}

/* The line under the play button is built from the format the button would
   actually deal, so the promise cannot drift from the match it starts.
   Exported because a challenge link promises the same match on another page. */
export function modeBlurb(mode: Mode, speed: Speed = 'standard'): string {
  const f = formatFor(mode, true, speed);
  const shape =
    mode === 'six-max'
      ? `Last player standing. ${f.players} seats, ${f.stack} units each.`
      : `Best of ${f.hands} hands. ${f.stack} units each.`;
  return `${shape} ${scheduleLine(f)}`;
}

/* How the blinds move, and how long the table can therefore last. Both read
   off the format rather than written down twice: the schedules are designed
   against these ceilings and the arithmetic for each one is in the protocol
   beside it. */
function scheduleLine(f: MatchFormat): string {
  const cap = capText(f);
  if (speedOf(f) === 'fast') return `Blinds climb every ${f.levelSeconds} seconds, so it is over ${cap}.`;
  if (f.levels.length > 1 && f.levelHands > 0 && f.mode === 'six-max') {
    return `Blinds climb every ${f.levelHands} hands, ${cap}.`;
  }
  return `Blinds start at ${f.sb} and ${f.bb} and stay there, ${cap}.`;
}

function capText(f: MatchFormat): string {
  const minutes = Math.round(ceilingFor(speedOf(f)) / 60_000);
  return minutes >= 60 ? `up to ${minutes / 60} hours` : `inside ${minutes} minutes`;
}

/* The game this player is pinned to: whatever they last chose, and failing
   that whatever they have played most, which is the same rule their profile
   opens on. A player who has played nothing is pinned to six handed, because
   that is the main game. */
function pinnedMode(me: Me | null): ModeChoice {
  const last = readPlayChoice();
  if (last) return last.mode;
  return me ? mainModeOf(me) : 'six-max';
}

export function Home() {
  const { me, queue, startQueue, startPractice, cancelQueue, offline, ready, conn, liveMatch, clearFound } =
    useSession();
  const nav = useNavigate();
  const searching = queue.s === 'searching';
  const { hash } = useLocation();
  useTitle(null);
  const now = useNow(searching, 250);

  /* One pinned format, three toggles, one button. The panel opens on the
     choice this player last made; a player who has made none is opened on the
     game they play most, and a player with no matches at all on the default.
     The pin is resolved again when the account lands, because the first
     render happens before /api/me has answered. */
  const [last] = useState(() => readPlayChoice());
  const [mode, setMode] = useState<ModeChoice>(() => pinnedMode(null));
  const [rated, setRated] = useState(last?.rated ?? true);
  /* Any is the default speed. A player who has chosen before keeps what they
     chose, including a narrow one. */
  const [speed, setSpeed] = useState<SpeedChoice>(last?.speed ?? 'any');
  const [pinned, setPinned] = useState(last != null);

  useEffect(() => {
    if (pinned || !me) return;
    setMode(mainModeOf(me));
    setPinned(true);
  }, [me, pinned]);

  /* Rated play opens after one finished casual or practice match. The server
     refuses it either way; the control says so rather than letting somebody
     press a button that answers no. A page that has not heard from the server
     yet assumes it is open, so the control does not flicker shut on load. */
  const rankedLocked = me != null && me.rankedUnlocked === false;

  /* And the other reason ranked can be shut: a walkout ban. It runs out on
     its own, so the line counts down rather than sitting on a number that
     went stale the moment it was drawn. Absent or past reads as no ban, the
     same bargain `rankedUnlocked` makes. */
  const banUntil = me?.rankedBanUntil ?? null;
  const banNow = useNow(banUntil !== null, 1000);
  const rankedBanned = banUntil !== null && banUntil > banNow;

  const willBeRated = rated && !rankedLocked && !rankedBanned;

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

  const seats = formatFor(queue.mode, queue.rated, queue.speed).players;
  const searchingFor = queue.practice
    ? 'Dealing you in against the bots'
    : `Searching for a ${SPEED_NAME[queue.speed]} ${modeInline(queue.mode)} table`;

  return (
    <main className="page wide stack home-page">
      <PlayerBar me={me} mode={modesFor(mode)[0]} />

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

      <section className="home-top">
        {!searching ? (
          <div className="card play-panel">
            <span className="t">Play</span>
            <div className="play-toggles">
              {/* Speed and table size can both say "any". With this few people
                  playing, four queues of nearly nobody is a slower game than
                  one wide search, so the widest of them is the default and a
                  player narrows it only if they care. Ranked cannot: see
                  `ModeChoice` in the protocol. */}
              <Segmented
                label="Speed"
                options={SPEED_CHOICES.map((sp) => ({
                  value: sp,
                  label:
                    sp === 'fast' ? (
                      <>
                        <Lightning size={14} weight="fill" aria-hidden="true" />
                        {SPEED_NAME[sp]}
                      </>
                    ) : (
                      speedChoiceName(sp)
                    ),
                }))}
                value={speed}
                onPick={(v) => setSpeed(v as SpeedChoice)}
              />
              <Segmented
                label="Ranked or casual"
                options={[
                  { value: 'ranked', label: 'Ranked' },
                  { value: 'casual', label: 'Casual' },
                ]}
                value={willBeRated ? 'ranked' : 'casual'}
                onPick={(v) => setRated(v === 'ranked')}
                disabled={(v) => v === 'ranked' && (rankedLocked || rankedBanned)}
              />
              <Segmented
                label="Table size"
                options={MODE_CHOICES.map((m) => ({ value: m, label: modeTabLabel(m) }))}
                value={mode}
                onPick={(v) => setMode(v as ModeChoice)}
              />
            </div>

            <span className="muted">{choiceBlurb(mode, speed)}</span>
            {rankedLocked && (
              <span className="muted">Play one casual game first. Ranked opens as soon as it finishes.</span>
            )}
            {rankedBanned && <span className="muted">{rankedBanText(banUntil!, banNow)}</span>}
            {queue.error && <span className="badge badge-warn">{queue.error}</span>}

            <button
              type="button"
              className="btn btn-primary btn-lg play-go"
              disabled={!ready || offline}
              onClick={() => startQueue(mode, willBeRated, speed)}
            >
              Play
            </button>

            <div className="play-ways">
              {/* Practice deals now, so it has nothing to widen: a table has
                  to have a size before it can be dealt. */}
              <PracticeWay
                onPlay={startPractice}
                disabled={!ready || offline}
                pinnedMode={modesFor(mode)[0]}
              />
              <ArenaWay />
              <LinkWay kind="challenge" disabled={!ready || offline} />
              <LinkWay kind="home" disabled={!ready || offline} />
            </div>

            {liveMatch && (
              <Link className="btn btn-secondary" to={`/m/${liveMatch}`}>
                Return to your match
              </Link>
            )}
            {!offline && conn === 'waiting' && <span className="muted">Connection dropped. Reconnecting.</span>}
          </div>
        ) : (
          <div className="card searching-card" role="status">
            <span className="t">{searchingFor}</span>
            <div className="searching">
              <span className="spinner" aria-hidden="true" />
              <span className="el num">{elapsed(now - queue.since)}</span>
              <span className="badge badge-plain">
                {queue.practice ? 'Practice' : queue.rated ? 'Ranked' : 'Casual'}
              </span>
              <span className="badge badge-plain">{SPEED_NAME[queue.speed]}</span>
              {queue.mode === 'six-max' && queue.seated != null && (
                <span className="badge badge-plain num">
                  {queue.seated} of {seats} seated
                </span>
              )}
              {queue.range != null && <span className="badge badge-plain num">Within {Math.round(queue.range)} rating</span>}
              <button type="button" className="btn btn-tertiary btn-sm" onClick={cancelQueue}>
                Cancel search
              </button>
            </div>
            {/* Why the last table did not happen, when there was one. It sits
                on the searching card because that is where the answer is: the
                search carried on without you having to restart it. */}
            {queue.error && <span className="muted">{queue.error}</span>}
          </div>
        )}

        <div className="home-right">
          <div className="home-side">
            <PuzzlesCard />
            <LearnCard />
            <WatchCard />
          </div>
          {/* Under the three teasers: the people you play with, and the
              tournaments coming up. Each card fetches for itself. */}
          <div className="home-under">
            {/* FriendsCard */}
            {/* TournamentsCard */}
          </div>
        </div>
      </section>

      <StatsStrip />

      <RecentMatches />

      <Leaderboard mode={modesFor(mode)[0]} />

      {/* The three promises this site is built on. They sat above the picker
          when the page led with a headline; the panel leads now, so they sit
          under the board where somebody scrolling to the bottom meets them.
          Kept rather than dropped with the headline: they are the only place
          on the page that says there is no money in any of this. */}
      <section className="how">
        <div className="card">
          <span className="k">1</span>
          <span className="t">No money, ever</span>
          <span className="muted">No buy-ins, no rake, no ads. Nothing to purchase.</span>
        </div>
        <div className="card">
          <span className="k">2</span>
          <span className="t">Chips reset every match</span>
          <span className="muted">
            Everyone starts on 200 units. The blinds climb until one player has the lot.
          </span>
        </div>
        <div className="card">
          <span className="k">3</span>
          <span className="t">Rating is the score</span>
          <span className="muted">Glicko-2, updated once per match. That is the whole ladder.</span>
        </div>
      </section>

      <footer className="home-foot">
        Every hand is <Link to="/learn/fair">provably fair</Link>. Every match is public.{' '}
        <Link to="/learn">Learn how to play</Link>
      </footer>
    </main>
  );
}

/* Who is playing, at the top of their own page: the picture, the name, the
   flag and the one rating that means anything to them, which is the rating
   for the game the panel below is pinned to. A guest gets the same row, since
   a guest plays here like anybody else.

   A mode with no rated match behind it says so rather than printing the 1500
   everybody starts on as though it were earned. */
function PlayerBar({ me, mode }: { me: Me | null; mode: Mode }) {
  if (!me) return <div className="player-bar" aria-hidden="true" />;
  const r = modeRating(me, mode);
  return (
    <div className="player-bar">
      <Avatar seed={avatarSeed(me.id, me.name)} name={me.name} size={44} avatarV={avatarVersion(me.avatarV)} />
      <div className="pb-who">
        {/* The page's heading is the player's own name, because that is what
            this page is about. Nothing else on it is a heading of that rank. */}
        <h1 className="pb-name">
          {me.country && <Flag code={me.country} size={20} />}
          {me.name}
        </h1>
        {/* The rating reads beside the name it belongs to, not off on its own
            at the far edge of the row: the one number that matters here is
            "Gabriel 1567", not a name and then a number a foot away from it. */}
        {r.matches === 0 ? (
          <span className="muted">No ranked matches yet</span>
        ) : (
          <>
            <span className="pb-rating num">{int(r.rating)}</span>
            {r.provisional && <span className="badge badge-warn">Provisional</span>}
          </>
        )}
        <span className="muted pb-mode">{MODE_NAME[mode]}</span>
      </div>
    </div>
  );
}

/* One of the other ways to play. Closed it is a single line with an icon and
   a name; open it is that line with the controls it needs underneath, which
   is how a practice level and a link's stake keep existing without four more
   cards on the page. `aria-expanded` is what says which it is. */
function Way({
  icon,
  label,
  note,
  open,
  onToggle,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  note?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="way" data-open={open ? '' : undefined}>
      <button type="button" className="btn btn-secondary way-go" aria-expanded={open} onClick={onToggle}>
        <span className="way-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="way-label">{label}</span>
        {note && <span className="way-note muted">{note}</span>}
      </button>
      {open && <div className="way-body">{children}</div>}
    </div>
  );
}

/* The arena is a pointer at its own page rather than something that opens
   here, because joining one is a thing you do beside the board you are
   joining. The line beside the name is written by the same function the arena
   page's clock is, so the two cannot describe the same arena differently. */
function ArenaWay() {
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
  const note = failed ? 'Every hour' : arenaCardLine(featured, now);

  return (
    <Link className="btn btn-secondary way-go" to={featured ? `/arena/${featured.id}` : '/arena'}>
      <span className="way-icon" aria-hidden="true">
        <Trophy size={16} />
      </span>
      <span className="way-label">Hourly arena</span>
      <span className="way-note muted">{note}</span>
    </Link>
  );
}
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


/* Three named presets, never rated, and the row that can deal a table
   without the queue. The mode is not asked for again: practice is played at
   whatever the panel above is pinned to, since a preset answers "let me try
   this" and a second table-size control here would be the same question
   twice.

   Easy, medium and hard are one shared table, `PRACTICE_PRESETS` in the
   protocol, so this row and the `/bots` setup page it links to cannot
   describe "hard" differently, and the level 6 bot landing in another
   branch only has to move that one table. `More` is for anyone who wants
   the level, the format and the individual bots spelled out before they
   press play. */
const PRESET_LABEL: Record<PracticePreset, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

function PracticeWay({
  onPlay,
  disabled,
  pinnedMode,
}: {
  onPlay: (mode: Mode, level: number) => void;
  disabled: boolean;
  pinnedMode: Mode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Way
      icon={<Cpu size={16} />}
      label="Practice against bots"
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      <span className="muted">
        Live equity and outs are shown at the table. Practice matches are never rated.
      </span>
      <div className="practice-presets">
        {(Object.keys(PRACTICE_PRESETS) as PracticePreset[]).map((preset) => (
          <button
            key={preset}
            type="button"
            className="btn btn-primary"
            disabled={disabled}
            onClick={() => onPlay(pinnedMode, PRACTICE_PRESETS[preset])}
          >
            {PRESET_LABEL[preset]}
          </button>
        ))}
        <Link className="btn btn-secondary" to="/bots">
          More
        </Link>
      </div>
    </Way>
  );
}

/* What a remembered challenge link amounts to now: still waiting, spent, or
   taken for a match that is still being played, which is a table to walk to.
   A match already over is spent like any other used link, so a creator who
   comes back hours later is not bounced to a finished game. */
type LinkState = 'open' | 'spent' | { go: string };

async function settleChallenge(id: string): Promise<LinkState> {
  const c = await api.challenge(id);
  if (c.status === 'open') return 'open';
  if (c.status === 'accepted' && c.matchId) {
    const m = await api.match(c.matchId);
    if (m.status === 'playing') return { go: c.matchId };
  }
  return 'spent';
}

/* The two shared links, one row each. A heads-up challenge seats exactly two
   people and starts itself the moment the second one accepts; a home game is
   the six handed version, a lobby friends gather in and a host starts, with
   the seats nobody took filled by bots at a level the host picks.

   They were one card with a kind toggle and are now two rows, which is one
   control fewer and one less question to answer before making a link. The
   kind is a prop rather than state; everything else is what it always was. */
function LinkWay({ kind, disabled }: { kind: LinkKind; disabled: boolean }) {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [rated, setRated] = useState(true);
  const [level, setLevel] = useState(2);
  const [link, setLink] = useState<SavedLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* A remembered link is only shown once the server says it is still waiting,
     the same bargain the remembered live match makes. One link is remembered
     per browser, so the row it belongs to is the one that shows it and the
     other row never opens on somebody else's link. A challenge that has been
     taken is not simply dropped: if the match it started is still on, this
     page walks to it, exactly as it does on `q found`. */
  useEffect(() => {
    const saved = readChallenge();
    if (!saved || saved.kind !== kind) return;
    let live = true;
    const still =
      saved.kind === 'home'
        ? api.homeGame(saved.id).then((g) => (g.status === 'open' ? 'open' : 'spent'))
        : settleChallenge(saved.id);
    still
      .then((state) => {
        if (!live) return;
        if (state === 'open') {
          setLink(saved);
          setOpen(true);
        } else {
          writeChallenge(null);
          if (state !== 'spent') nav(`/m/${state.go}`);
        }
      })
      .catch(() => writeChallenge(null));
    return () => {
      live = false;
    };
  }, [kind, nav]);

  /* The socket is how the creator is told their friend has accepted, and a
     phone drops the socket the moment its owner switches to a messaging app
     to send the link, which is the one thing the creator does next. So while
     a challenge is waiting this row also asks: every five seconds, and again
     the instant the tab comes back to the front, which is when the push was
     most likely missed. A home game needs none of this, because its host is
     the one who starts it. */
  useEffect(() => {
    if (!link || kind !== 'challenge') return;
    let live = true;
    const ask = () =>
      settleChallenge(link.id)
        .then((state) => {
          if (!live || state === 'open') return;
          writeChallenge(null);
          setLink(null);
          if (state !== 'spent') nav(`/m/${state.go}`);
        })
        .catch(() => {
          /* asked again on the next tick */
        });
    const timer = setInterval(ask, 5_000);
    const onShow = () => {
      if (document.visibilityState === 'visible') void ask();
    };
    document.addEventListener('visibilitychange', onShow);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [link, kind, nav]);

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
      setError(e instanceof ApiError ? e.message : 'The link could not be made. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  /* The link leaves this page the moment it is cancelled: the request that
     spends it on the server is the tidy-up, and a failed one only means the
     link sits unused until it expires. */
  const drop = async () => {
    if (!link) return;
    const { id } = link;
    writeChallenge(null);
    setLink(null);
    setError(null);
    try {
      if (kind === 'home') await api.cancelHomeGame(id);
      else await api.cancelChallenge(id);
    } catch {
      /* it expires on its own within the day either way */
    }
  };

  const home = kind === 'home';

  return (
    <Way
      icon={home ? <UsersThree size={16} /> : <LinkIcon size={16} />}
      label={home ? 'Home game' : 'Play a friend'}
      note={link ? 'Link waiting' : undefined}
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      {link ? (
        <>
          <ShareLink url={link.url} what={home ? 'table' : 'challenge'} />
          {home ? (
            <>
              <span className="muted">
                Your table is waiting. Open it to see who has arrived and start the game.
              </span>
              <Link className="btn btn-primary" to={`/g/${link.id}`}>
                Open your table
              </Link>
            </>
          ) : (
            <>
              <span className="muted">Waiting for your friend. The link works for 24 hours.</span>
              {/* A page to wait on, rather than this row: it polls the link
                  and walks to the table the moment the friend is in. */}
              <Link className="btn btn-primary" to={`/c/${link.id}`}>
                Wait for your friend
              </Link>
            </>
          )}
          <button type="button" className="btn btn-tertiary btn-sm" onClick={drop}>
            Cancel link
          </button>
        </>
      ) : (
        <>
          <span className="muted">
            {home
              ? 'A private six handed table. Gather up to six in a lobby and start it when you like.'
              : 'A heads-up link that starts the match the moment your friend opens it.'}
          </span>
          <Segmented
            label={home ? 'Home game stake' : 'Challenge stake'}
            options={[
              { value: 'ranked', label: 'Ranked' },
              { value: 'casual', label: 'Casual' },
            ]}
            value={rated ? 'ranked' : 'casual'}
            onPick={(v) => setRated(v === 'ranked')}
          />
          {home && (
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
                        Level {b.level}, {b.name}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
              <span className="muted">
                A ranked home game needs two people at it. One person and five bots plays casual.
              </span>
            </>
          )}
          {error && <span className="badge badge-warn">{error}</span>}
          <button type="button" className="btn btn-primary" disabled={disabled || busy} onClick={make}>
            Create a link
          </button>
        </>
      )}
    </Way>
  );
}

/* Puzzles, learning and watching: three cards beside the play panel, each one
   fact and one button. None of them is a second way to start a match, which
   is why they are here rather than in the column above.

   The puzzle standing is kept in this browser and nowhere else, so the card
   reads it straight rather than asking the server for something the server
   does not know. Accuracy needs a denominator, so a player who has answered
   nothing gets the count instead of a percentage of zero. */
function PuzzlesCard() {
  const puzzles = useMemo(() => readPuzzles(), []);
  const totals = Object.values(puzzles.types).reduce(
    (sum, t) => ({ right: sum.right + t.right, total: sum.total + t.total }),
    { right: 0, total: 0 }
  );

  return (
    <div className="card side-card">
      <span className="t"><PuzzlePiece size={16} aria-hidden="true" />Puzzles</span>
      {totals.total > 0 ? (
        <span className="muted">
          <b className="num num-lg">{totals.right}/{totals.total}</b>
        </span>
      ) : (
        <span className="muted">Three kinds, all built from real hands played here.</span>
      )}
      <Link className="btn btn-secondary" to="/puzzles">
        Solve a puzzle
      </Link>
    </div>
  );
}

/* The lessons in reading order. Nothing records which have been read, so the
   card offers the first one rather than claiming to know where somebody got
   to: a card that says "next" about a lesson you finished a week ago is worse
   than one that simply points at the beginning. */
function LearnCard() {
  const lesson = LESSONS[0];
  return (
    <div className="card side-card">
      <span className="t"><GraduationCap size={16} aria-hidden="true" />Learn</span>
      <span className="muted">{lesson.title}. {lesson.blurb}</span>
      <Link className="btn btn-secondary" to={`/learn/${lesson.slug}`}>
        Read the first lesson
      </Link>
    </div>
  );
}

/* A table being played right now, if there is one. Every match here is public
   and every one has a permanent page, so this is the one card that is about
   somebody else's game rather than yours. */
function WatchCard() {
  const [live, setLive] = useState<LiveMatch[] | null>(null);

  useEffect(() => {
    let running = true;
    api
      .live()
      .then((rows) => running && setLive(rows))
      .catch(() => running && setLive([]));
    return () => {
      running = false;
    };
  }, []);

  const table = live?.[0] ?? null;
  return (
    <div className="card side-card">
      <span className="t"><Eye size={16} aria-hidden="true" />Watch</span>
      <span className="muted">
        {table
          ? `${table.players.map((p) => p.name).join(' and ')}, hand ${table.hand}`
          : 'Nothing is being played right now.'}
      </span>
      <Link className="btn btn-secondary" to={table ? `/m/${table.id}` : '/watch'}>
        {table ? 'Watch this table' : 'See the tables'}
      </Link>
    </div>
  );
}
/* The peek follows the mode the panel is pinned to, so the board underneath
   is the ladder the button above it plays for. */
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
        <span className="h2">Top ten, {modeInline(mode)}</span>
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
                          {/* Reserved, like the full board's: this is a column
                              of names and a flag on some rows would leave the
                              rest of them out of line. The board itself has
                              had one since flags existed and this preview of
                              it never did, which read as the flag failing to
                              show rather than as a preview that omits it. */}
                          <FlagSlot code={r.country} size={16} />
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
  wins: 0,
  peak: 0,
}));
