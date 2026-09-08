import { useCallback, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { ServerMsg } from '@opentable/protocol';
import { api } from '../net/api.ts';
import { opponentNames, useServerMsg, useSession } from '../net/session.tsx';
import { sound } from '../sound/index.ts';

/* Two site-wide cues that a match is yours. Both live outside the table,
   because the whole point of them is being somewhere else when it happens. */

/* The pill in the top bar. Only ever for a seat: watching a table is not a
   thing you can be late for, so a spectator is never told to come back. It
   hides on the table it points at, where it would be a link to the page you
   are reading. */
export function PlayingPill() {
  const { liveMatch, liveOpponents } = useSession();
  const { pathname } = useLocation();
  if (!liveMatch || pathname === `/m/${liveMatch}`) return null;
  return (
    <Link className="playing-pill" to={`/m/${liveMatch}`}>
      <span className="dot" aria-hidden="true" />
      <span className="pl-what">You are playing</span>
      <span className="pl-short">Playing</span>
      {liveOpponents && <b className="pl-who">{liveOpponents}</b>}
    </Link>
  );
}

/* A match found while you are somewhere else. The home page navigates to the
   table itself, as it always has, so this is only ever the other pages: a
   toast that says what happened and one button that goes there. The sound
   plays wherever you are, home included, because a match starting is worth
   hearing before it is worth reading. */
export function MatchFoundAlert() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const { clearFound, me } = useSession();
  /* A matchmade table announces itself twice over otherwise: once when the
     ready check asks, and again a second later when the table it turned into
     arrives. The check is the moment worth hearing, so the cue is skipped for
     any table that came through one. Every other path here, a challenge link,
     a home game, practice, has no check and still gets it. */
  const viaCheck = useRef(false);

  const announce = useCallback(
    async (matchId: string) => {
      let who: string | null = null;
      try {
        const match = await api.match(matchId);
        who = opponentNames(match.seats.filter((s) => s.userId !== me?.id).map((s) => s.name));
      } catch {
        /* The name is the nicety, the table is the point. */
      }
      window.g?.toast({
        title: who ? `Your match with ${who} has started` : 'Your match has started',
        kind: 'ok',
        action: {
          label: 'Open the table',
          onClick: () => {
            clearFound();
            nav(`/m/${matchId}`);
          },
        },
      });
    },
    [nav, clearFound, me],
  );

  useServerMsg((m: ServerMsg) => {
    if (m.t === 'ready') {
      viaCheck.current = m.s !== 'cancelled';
      return;
    }
    if (m.t !== 'q' || m.s !== 'found' || !m.m) return;
    if (viaCheck.current) viaCheck.current = false;
    else void sound.play('yourTurn');
    /* Pages that walk to the table by themselves get no toast: home, the
       table, and the two lobbies (a challenge or a home game link), which
       would otherwise leave the toast lying on the felt after they moved. */
    if (pathname === '/' || pathname === `/m/${m.m}` || pathname.startsWith('/c/') || pathname.startsWith('/g/')) return;
    void announce(m.m);
  });

  return null;
}
