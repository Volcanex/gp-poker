import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../net/api.ts';
import { avatarSeed, modeRating, avatarVersion } from '../net/adapt.ts';
import type { Challenge as ChallengeLink } from '../net/types.ts';
import { useSession } from '../net/session.tsx';
import { Avatar } from '../ui/avatar.tsx';
import { Flag } from '../ui/flag.tsx';
import { ShareLink } from '../ui/share-link.tsx';
import { int } from '../ui/format.ts';
import { useTitle } from '../ui/title.ts';
import { modeBlurb } from './home.tsx';

/* The other end of "play a friend": the page the link opens. Everything it
   needs is on one request, so a person who has never been here lands on a
   name, a format and one button.

   Accepting is what creates the match, and it is the server that decides
   whether the link is still worth anything: this page renders the status it
   was given and reports what came back rather than working the rules out
   again on its own. */
export function Challenge() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { me } = useSession();
  const [link, setLink] = useState<ChallengeLink | null>(null);
  const [missing, setMissing] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* The creator's own spent link: true once the server has said the match
     it started is already over, which is the only case the creator is shown
     a spent page for rather than the table. */
  const [over, setOver] = useState(false);
  useTitle(link ? `Play ${link.creator.name}` : null);

  useEffect(() => {
    let live = true;
    setLink(null);
    setMissing(false);
    api
      .challenge(id)
      .then((c) => live && setLink(c))
      .catch(() => live && setMissing(true));
    return () => {
      live = false;
    };
  }, [id]);

  const mine = me?.id === link?.creator.id;

  /* The creator on their own link. Waiting, the page asks every five seconds
     whether the friend has arrived, because the socket that would say so is
     the one a phone drops while its owner is off sending the link; taken,
     it walks to the table if the match is still on, since a creator who
     followed their own link back is looking for their game and not for a
     notice that it exists. A match already over is a spent link. */
  useEffect(() => {
    if (!link || !mine) return;
    let live = true;
    if (link.status === 'open') {
      const ask = () => api.challenge(id).then((c) => live && setLink(c)).catch(() => {});
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
    }
    if (link.status === 'accepted' && link.matchId) {
      const m = link.matchId;
      api
        .match(m)
        .then((match) => {
          if (!live) return;
          if (match.status === 'playing') nav(`/m/${m}`, { replace: true });
          else setOver(true);
        })
        .catch(() => live && setOver(true));
    }
    return () => {
      live = false;
    };
  }, [link, mine, id, nav]);

  const accept = useCallback(async () => {
    setAccepting(true);
    setError(null);
    try {
      const { matchId } = await api.acceptChallenge(id);
      nav(`/m/${matchId}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The table could not be opened. Try the link again.');
      setAccepting(false);
      // The link may have been taken or cancelled while this page sat open,
      // so what it says next comes from the server, not from a guess.
      api.challenge(id).then(setLink).catch(() => setMissing(true));
    }
  }, [id, nav]);

  if (missing) {
    return (
      <Shell>
        <div className="empty">
          <h1 className="e-title">This link does not work</h1>
          <span className="e-desc">It may be mistyped. Start a match from the home page instead.</span>
          <Link className="btn btn-secondary btn-sm" to="/">Go to the home page</Link>
        </div>
      </Shell>
    );
  }

  /* The creator's taken link is a table being opened, until the server says
     the match is over. */
  const opening = link != null && mine && link.status === 'accepted' && link.matchId != null && !over;

  if (!link || opening) {
    return (
      <Shell>
        <div className="searching">
          <span className="spinner" aria-hidden="true" />
          <span className="muted">{opening ? 'Opening your table' : 'Opening the challenge'}</span>
        </div>
      </Shell>
    );
  }

  if (link.status === 'expired' || link.status === 'cancelled') {
    const expired = link.status === 'expired';
    return (
      <Shell>
        <div className="empty">
          <h1 className="e-title">{expired ? 'This link has expired' : 'This challenge was cancelled'}</h1>
          <span className="e-desc">
            {expired
              ? 'A challenge link works for 24 hours. Ask for a new one, or play the queue instead.'
              : `${link.creator.name} took this link back. Ask for a new one, or play the queue instead.`}
          </span>
          <Link className="btn btn-secondary btn-sm" to="/">Go to the home page</Link>
        </div>
      </Shell>
    );
  }

  if (link.status === 'accepted') {
    return (
      <Shell>
        <div className="empty">
          <h1 className="e-title">{mine ? 'This link has been played' : 'This challenge was already taken'}</h1>
          <span className="e-desc">
            {mine ? 'Your friend opened it and the match is over.' : 'Somebody opened this link first.'}
          </span>
          <span className="tags">
            {link.matchId && (
              <Link className="btn btn-secondary btn-sm" to={`/m/${link.matchId}`}>
                {mine ? 'See the match' : 'Go to the match'}
              </Link>
            )}
            <Link className="btn btn-tertiary btn-sm" to="/">Go to the home page</Link>
          </span>
        </div>
      </Shell>
    );
  }

  /* The creator's waiting room. The page keeps asking (above) and walks to
     the table the moment the friend is in, so this is where a creator sits
     rather than the home page's row, and it says so. */
  if (mine) {
    return (
      <Shell>
        <div className="mode-head">
          <h1 className="t">Waiting for your friend</h1>
        </div>
        <span className="muted">
          Send them this link. The match starts the moment they open it, and this page will take
          you to the table.
        </span>
        <ShareLink url={`${location.origin}/c/${link.id}`} />
        <div className="searching">
          <span className="spinner" aria-hidden="true" />
          <span className="muted">Waiting for your friend. The link works for 24 hours.</span>
        </div>
        <span className="tags">
          <button
            type="button"
            className="btn btn-tertiary btn-sm"
            onClick={() => {
              api.cancelChallenge(id).catch(() => {});
              nav('/');
            }}
          >
            Cancel link
          </button>
        </span>
      </Shell>
    );
  }

  const rating = modeRating(link.creator, link.mode);

  return (
    <Shell>
      <div className="mode-head">
        <span className="player-cell">
          <Avatar
            seed={avatarSeed(link.creator.id, link.creator.name)}
            name={link.creator.name}
            avatarV={avatarVersion(link.creator.avatarV)}
          />
          {link.creator.country && <Flag code={link.creator.country} size={20} />}
          <h1 className="t">{link.creator.name} wants to play you</h1>
        </span>
      </div>
      <span className="tags">
        <span className="badge badge-plain">Heads-up</span>
        <span className="badge badge-plain">{link.rated ? 'Rated' : 'Casual'}</span>
      </span>
      <span className="muted">{modeBlurb(link.mode)}</span>
      {rating.matches === 0 ? (
        <span className="muted">They have no rated heads-up matches yet.</span>
      ) : (
        <span className="tags muted">
          <span>
            Their rating <span className="num">{int(rating.rating)}</span>
            <span className="rd num">+-{int(rating.rd)}</span>
          </span>
          {rating.provisional && <span className="badge badge-warn">Provisional</span>}
        </span>
      )}
      {error && <span className="badge badge-warn">{error}</span>}
      <button type="button" className="btn btn-primary" disabled={accepting} onClick={accept}>
        Accept and play
      </button>
      <span className="muted">
        No account needed. You are dealt in as a guest and can claim the name later.
      </span>
    </Shell>
  );
}

/* The same card in every state, so the page does not jump as the challenge
   loads and the button lands where the spinner was. */
function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="page stack">
      <section className="hero">
        <div className="card mode" style={{ maxWidth: 460 }}>{children}</div>
      </section>
    </main>
  );
}
