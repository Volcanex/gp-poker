import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { UsersThree } from '@phosphor-icons/react/dist/icons/UsersThree';
import { api } from '../net/api.ts';
import { avatarSeed, avatarVersion } from '../net/adapt.ts';
import { pathUnder, useFriends } from '../net/friends.tsx';
import { useSession } from '../net/session.tsx';
import type { Friend, FriendInvite, FriendRequest, PlayedPerson } from '../net/types.ts';
import { Avatar } from '../ui/avatar.tsx';
import { FlagSlot } from '../ui/flag.tsx';
import {
  AddFriendField, FriendAction, InviteButton, useClaimPrompt, useIsPlayer,
} from '../ui/friend-controls.tsx';
import { useNow } from '../ui/bits.tsx';
import { int } from '../ui/format.ts';
import { modeInline } from '../ui/mode-tabs.tsx';
import { useTitle } from '../ui/title.ts';
import { presenceLine, sortFriends } from './friend-bits.ts';
import { ago } from './feed.tsx';
import './friends.css';

/* Friends: the list, the requests either way, the tables friends have offered
   and the people you have actually played. The page and the home card are one
   file because they are one feature drawn at two sizes, and the row is one
   component for the reason `arena-bits.ts` exists: two screens describing the
   same friend differently is the defect worth spending a file to avoid.

   The list itself is held once for the whole app (`../net/friends.tsx`) and
   refetched on every push, so nothing here polls and nothing here patches. */

/* Eight rows, which is what the feed's own home block holds, and the same
   reason: a card beside the play panel is a glance and not a list. */
const CARD_ROWS = 8;

export function FriendsPage() {
  const { data, loaded } = useFriends();
  const isPlayer = useIsPlayer();
  useTitle('Friends');

  const friends = sortFriends(data?.friends ?? []);

  return (
    <main className="page stack">
      <div className="stack" style={{ gap: 'var(--sp-3)' }}>
        <h1 className="h1">Friends</h1>
        <span className="muted">
          Play the same people again. A friend has to have claimed their account, so there is a
          name to look for rather than a guest who was here once.
        </span>
      </div>

      {!isPlayer ? (
        <ClaimBlock />
      ) : (
        <div className="card">
          <AddFriendField />
        </div>
      )}

      {data && data.invites.length > 0 && (
        <section className="stack" style={{ gap: 'var(--sp-3)' }}>
          <span className="h2">Tables waiting for you</span>
          <div className="card friend-list">
            {data.invites.map((invite) => (
              <InviteRow key={`${invite.kind}-${invite.id}`} invite={invite} />
            ))}
          </div>
        </section>
      )}

      {data && data.incoming.length > 0 && (
        <section className="stack" style={{ gap: 'var(--sp-3)' }}>
          <span className="h2">Asking to be friends</span>
          <div className="card friend-list">
            {data.incoming.map((r) => (
              <RequestRow key={r.id} request={r} />
            ))}
          </div>
        </section>
      )}

      <section className="stack" style={{ gap: 'var(--sp-3)' }} data-enter-ready={loaded ? 'yes' : 'no'}>
        <span className="h2">Your friends</span>
        <div className="card friend-list">
          {friends.length === 0 ? (
            <div className="empty">
              <span className="e-title">No friends yet</span>
              <span className="e-desc">
                Add somebody by name, or pick one of the people you have played below.
              </span>
            </div>
          ) : (
            friends.map((friend) => <FriendRow key={friend.id} friend={friend} />)
          )}
        </div>
      </section>

      {data && data.outgoing.length > 0 && (
        <section className="stack" style={{ gap: 'var(--sp-3)' }}>
          <span className="h2">Waiting on an answer</span>
          <div className="card friend-list">
            {data.outgoing.map((r) => (
              <RequestRow key={r.id} request={r} />
            ))}
          </div>
        </section>
      )}

      <PlayedWith />
    </main>
  );
}

/* Signed out or playing as a guest. The same claim form the profile offers,
   because there is only one of it, with the sentence this page needs above
   it: a guest has not been refused anything, they simply have no name for a
   friend to look for. */
function ClaimBlock() {
  const claim = useClaimPrompt();
  return (
    <div className="card">
      <div className="empty">
        <span className="e-title">Friends need a claimed account</span>
        <span className="e-desc">
          A guest name is generated for the browser and given out again. Pick a name and a
          password, and your rating, matches and histories come with you.
        </span>
        <button type="button" className="btn btn-primary btn-sm" onClick={claim.ask}>
          Claim your account
        </button>
      </div>
      {claim.node}
    </div>
  );
}

/* One friend, at either size. The dot and the line beside the name are the
   whole of presence, and the box is kept whether or not the dot is lit, so a
   friend arriving cannot move the rest of the list. */
export function FriendRow({ friend, compact }: { friend: Friend; compact?: boolean }) {
  const { liveMatch } = useSession();
  const now = useNow(!friend.online, 60_000);
  const line = presenceLine(friend, liveMatch, now);

  return (
    <div className="friend-row">
      <Avatar
        seed={avatarSeed(friend.id, friend.name)}
        name={friend.name}
        size={compact ? 24 : 28}
        avatarV={avatarVersion(friend.avatarV)}
      />
      <FlagSlot code={friend.country} size={16} />
      <span className="fr-who">
        <Link className="fr-name" to={`/u/${encodeURIComponent(friend.name)}`}>
          {friend.name}
        </Link>
        <span className="fr-doing muted">
          <span className="fr-dot" data-here={line.here ? '' : undefined} aria-hidden="true" />
          {line.text}
        </span>
      </span>
      {!compact && (
        <span className="fr-rating num">
          {int(friend.rating)}
          <span className="fr-mode muted">{modeInline(friend.mode)}</span>
        </span>
      )}
      {friend.playing ? (
        <Link className="btn btn-tertiary btn-sm" to={`/m/${friend.playing}`}>
          Watch
        </Link>
      ) : (
        <InviteButton userId={friend.id} />
      )}
      {!compact && <FriendAction userId={friend.id} name={friend.name} />}
    </div>
  );
}

function RequestRow({ request }: { request: FriendRequest }) {
  return (
    <div className="friend-row">
      <Avatar
        seed={avatarSeed(request.id, request.name)}
        name={request.name}
        size={28}
        avatarV={avatarVersion(request.avatarV)}
      />
      <FlagSlot code={request.country} size={16} />
      <span className="fr-who">
        <Link className="fr-name" to={`/u/${encodeURIComponent(request.name)}`}>
          {request.name}
        </Link>
        <span className="fr-doing muted">{ago(request.at)}</span>
      </span>
      <span className="fr-rating num">
        {int(request.rating)}
        <span className="fr-mode muted">{modeInline(request.mode)}</span>
      </span>
      <FriendAction userId={request.id} name={request.name} />
    </div>
  );
}

/* A table a friend has already made. The invite lives as long as its link, so
   this row is here until the link is taken, cancelled or runs out, which is
   what makes a dismissed toast something other than a lost game. */
function InviteRow({ invite }: { invite: FriendInvite }) {
  const to = pathUnder(invite.url);
  return (
    <div className="friend-row">
      <Avatar
        seed={avatarSeed(invite.from.id, invite.from.name)}
        name={invite.from.name}
        size={28}
        avatarV={avatarVersion(invite.from.avatarV)}
      />
      <FlagSlot code={invite.from.country} size={16} />
      <span className="fr-who">
        <span className="fr-name">{invite.from.name}</span>
        <span className="fr-doing muted">
          {invite.kind === 'home' ? 'Has a home game open' : 'Wants to play heads-up'}
        </span>
      </span>
      <Link className="btn btn-primary btn-sm" to={to}>
        Play
      </Link>
    </div>
  );
}

/* Where friends come from on a poker site. It is its own request because it
   is a query over every match this player has been in, so the page asks for
   it once and only when somebody is looking at it. */
function PlayedWith() {
  const isPlayer = useIsPlayer();
  const [rows, setRows] = useState<PlayedPerson[] | null>(null);

  useEffect(() => {
    if (!isPlayer) return;
    let live = true;
    api
      .playedWith()
      .then((r) => live && setRows(r))
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [isPlayer]);

  if (!isPlayer) return null;

  return (
    <section className="stack" style={{ gap: 'var(--sp-3)' }} data-enter-ready={rows ? 'yes' : 'no'}>
      <span className="h2">People you have played</span>
      <span className="muted">The last twenty you sat down with, newest table first.</span>
      <div className="card friend-list">
        {rows && rows.length === 0 ? (
          <div className="empty">
            <span className="e-title">Nobody yet</span>
            <span className="e-desc">
              Play a rated or casual table and whoever was at it turns up here.
            </span>
          </div>
        ) : (
          (rows ?? []).map((person) => (
            <div className="friend-row" key={person.id}>
              <Avatar
                seed={avatarSeed(person.id, person.name)}
                name={person.name}
                size={28}
                avatarV={avatarVersion(person.avatarV)}
              />
              <FlagSlot code={person.country} size={16} />
              <span className="fr-who">
                <Link className="fr-name" to={`/u/${encodeURIComponent(person.name)}`}>
                  {person.name}
                </Link>
                <span className="fr-doing muted">Played {ago(person.lastPlayedAt)}</span>
              </span>
              <FriendAction userId={person.id} name={person.name} />
            </div>
          ))
        )}
      </div>
    </section>
  );
}

/* The home page's card, under the three teasers. Requests first, because they
   are the only thing on it waiting on an answer, then whoever is online, then
   the rest by when they were last here. Eight rows and a way to the page. */
export function FriendsCard() {
  const { data, loaded } = useFriends();
  const isPlayer = useIsPlayer();
  const claim = useClaimPrompt();

  const friends = sortFriends(data?.friends ?? []).slice(0, CARD_ROWS);
  const requests = data?.incoming ?? [];
  const invites = data?.invites ?? [];
  const more = (data?.friends.length ?? 0) > friends.length;

  return (
    <div className="card side-card friends-card" data-enter-ready={loaded ? 'yes' : 'no'}>
      <span className="t">
        <UsersThree size={16} aria-hidden="true" />
        Friends
      </span>

      {!isPlayer ? (
        <>
          <span className="muted">
            Claim your account to keep hold of the people you play. Your rating comes with you.
          </span>
          <button type="button" className="btn btn-secondary" onClick={claim.ask}>
            Claim your account
          </button>
          {claim.node}
        </>
      ) : (
        <>
          {invites.map((invite) => (
            <InviteRow key={`${invite.kind}-${invite.id}`} invite={invite} />
          ))}
          {requests.map((r) => (
            <CardRequestRow key={r.id} request={r} />
          ))}
          {friends.map((friend) => (
            <FriendRow key={friend.id} friend={friend} compact />
          ))}
          {friends.length === 0 && requests.length === 0 && invites.length === 0 && (
            <>
              <span className="muted">
                Nobody yet. Add somebody by the name they play under and you can deal them a
                table from here.
              </span>
              <AddFriendField />
            </>
          )}
          {(more || friends.length > 0) && (
            <Link className="btn btn-secondary" to="/friends">
              All friends
            </Link>
          )}
        </>
      )}
    </div>
  );
}

/* The card's own request row: accept and decline, and nothing else, because
   the card is half the width of the page and a rating on it would push the
   two controls that matter off the end. */
function CardRequestRow({ request }: { request: FriendRequest }) {
  return (
    <div className="friend-row">
      <Avatar
        seed={avatarSeed(request.id, request.name)}
        name={request.name}
        size={24}
        avatarV={avatarVersion(request.avatarV)}
      />
      <FlagSlot code={request.country} size={16} />
      <span className="fr-who">
        <Link className="fr-name" to={`/u/${encodeURIComponent(request.name)}`}>
          {request.name}
        </Link>
        <span className="fr-doing muted">Asking to be friends</span>
      </span>
      <FriendAction userId={request.id} name={request.name} />
    </div>
  );
}
