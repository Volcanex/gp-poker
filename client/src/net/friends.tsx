import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { ServerMsg } from '@opentable/protocol';
import { api } from './api.ts';
import type { FriendsPayload } from './types.ts';
import { useServerMsg, useSession } from './session.tsx';
import { sound } from '../sound/index.ts';

/* The friends list, held once for the whole app.

   **One copy, refetched rather than patched.** Every mutation on the server
   answers with a `friend` push that says only that something moved, so this
   asks for `/api/friends` again and there is never a second shape of the list
   to keep in step with the first. Presence arrives the same way: a friend's
   last socket closing is a push, not a poll, so nothing here runs on a timer.

   **It is here rather than on a page** for the reason the ready check is: four
   things read it (the home card, the friends page, the top bar's badge and the
   controls on a profile and a result), and an invite has to reach whoever is
   looking at whatever they are looking at.

   **A guest holds an empty list and asks for nothing.** Friends need a claimed
   account on both sides, so a guest's fetch would be one refusal per page
   load; the controls a guest can press offer the claim form instead. */

export interface FriendsState {
  data: FriendsPayload | null;
  /* Null while the first answer is in flight and after a refusal, so a card
     can hold its shape rather than claim an empty list. */
  loaded: boolean;
  /* Requests in, plus invites waiting: what the top bar counts, and the one
     number this file exists to keep true wherever somebody is standing. */
  waiting: number;
  refresh: () => void;
  request: (name: string) => Promise<void>;
  accept: (userId: string) => Promise<void>;
  remove: (userId: string) => Promise<void>;
}

const EMPTY: FriendsPayload = { friends: [], incoming: [], outgoing: [], invites: [] };

const Ctx = createContext<FriendsState | null>(null);

export function FriendsProvider({ children }: { children: ReactNode }) {
  const { me, ready } = useSession();
  const [data, setData] = useState<FriendsPayload | null>(null);
  const [loaded, setLoaded] = useState(false);
  const nav = useNavigate();
  const { pathname } = useLocation();

  /* A guest is not refused so much as not asked: the list is empty by the
     rule the feature is built on, and there is nothing to fetch. */
  const player = ready && me != null && !me.guest;

  const refresh = useCallback(() => {
    if (!player) {
      setData(EMPTY);
      setLoaded(true);
      return;
    }
    api
      .friends()
      .then((payload) => {
        setData(payload);
        setLoaded(true);
      })
      .catch(() => {
        /* The list goes stale rather than the page breaking; the next push
           or the next visit asks again. */
        setLoaded(true);
      });
  }, [player]);

  useEffect(refresh, [refresh]);

  /* The socket says something moved and this asks what. The message carries
     nothing on purpose (see `FriendEvent` in the protocol), so there is one
     answer to read and it is the one the page opened with.

     `q found` is the other thing that moves this list, and it is not a friend
     event: a table starting is the moment an invite's link is spent, for both
     the person who took it and the person who sent it, and the badge in the
     top bar would otherwise go on counting a table that has already dealt. */
  useServerMsg((m: ServerMsg) => {
    if (m.t === 'friend') refresh();
    else if (m.t === 'q' && m.s === 'found') refresh();
  });

  const value = useMemo<FriendsState>(() => {
    const held = data ?? EMPTY;
    return {
      data,
      loaded,
      waiting: held.incoming.length + held.invites.length,
      refresh,
      request: async (name: string) => {
        await api.requestFriend(name);
        refresh();
      },
      accept: async (userId: string) => {
        await api.acceptFriend(userId);
        refresh();
      },
      remove: async (userId: string) => {
        await api.removeFriend(userId);
        refresh();
      },
    };
  }, [data, loaded, refresh]);

  return (
    <Ctx.Provider value={value}>
      <InviteAlert pathname={pathname} onOpen={(url) => nav(pathUnder(url))} refresh={refresh} />
      {children}
    </Ctx.Provider>
  );
}

export function useFriends(): FriendsState {
  const s = useContext(Ctx);
  if (!s) throw new Error('useFriends used outside FriendsProvider');
  return s;
}

/* The url the server built is absolute, because it is a thing to paste into a
   message. Following it inside the app is a route, so the path is what the
   router is given: a full URL would reload the whole bundle to reach a page it
   is already holding. */
export function pathUnder(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/* An invite reaches whoever is looking at whatever they are looking at, which
   is the same job the match-found alert has and the same shape of answer: g's
   toast with one action, and the cue a table starting already plays.

   The toast is not the invite. It is dismissible and it does not survive a
   reload, so the list is refetched behind it and the friends page and the home
   card both carry the invite until its link is spent: a dismissed toast is
   never a lost table. */
function InviteAlert({
  pathname,
  onOpen,
  refresh,
}: {
  pathname: string;
  onOpen: (url: string) => void;
  refresh: () => void;
}) {
  const here = useRef(pathname);
  here.current = pathname;

  useServerMsg((m: ServerMsg) => {
    if (m.t !== 'invite') return;
    refresh();
    const to = pathUnder(m.url);
    /* Already standing on the page the invite points at: the link's own page
       fills in by itself, so a toast about it would be a toast about what is
       already on screen. */
    if (here.current === to) return;
    /* `matchFound` is not a sound event, and `yourTurn` is the packs'
       notification cue, which is what the match-found alert plays for the
       same reason: this is the nearest honest thing to it. */
    void sound.play('yourTurn');
    /* No `kind`: g ships an icon for ok, danger and loading, and an invite is
       none of the three. A plain toast is what the country picker's own is. */
    window.g?.toast({
      title: `${m.from.name} wants to play`,
      action: { label: 'Play', onClick: () => onOpen(m.url) },
    });
  });

  return null;
}
