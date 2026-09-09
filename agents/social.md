# Workstream: social (friends, presence, invites)

Worktree `/home/gabriel/opentable-wt-social`, branch `social`, private DB
`opentable_test_social`, preview port 4211, dev server port 8231. Read
`agents/_shared.md` first.

## Why
Open Table has links (challenge `/c/:id`, home game `/g/:id`), table chat,
public profiles and spectating, but no social graph at all: no friends, no
sense of who is online, no way to invite somebody without pasting a URL into
another app. Gabriel wants friends, playing with friends, and a friends list on
the home page under the three teaser cards.

## Done condition
1. **Friends.** Table `friendships` (requester, addressee, status
   `pending | accepted`, `created_at`, `responded_at`; a unique index on the
   unordered pair so two rows can never describe one pair). Both sides must be
   claimed accounts (`users.guest = false`): a guest's name is random and its
   row may never be seen again. A guest who presses any friend control gets the
   existing account-needed prompt the play panel already uses (find it in
   `client/src/routes/home.tsx` and reuse it). Bots can never be friends.
   - REST: `GET /api/friends` (friends with `online`, `playing` match id or
     null, `lastSeenAt`, rating for their main mode; plus `incoming` and
     `outgoing` requests; plus `invites` pending for me), `POST /api/friends/request`
     by name, `POST /api/friends/:userId/accept`, `DELETE /api/friends/:userId`
     (declines, cancels or unfriends, whichever the row is). Caps: 200 friends,
     20 open outgoing requests. A request to somebody who already requested you
     accepts instead. Every mutation pushes a `friend` server message to both
     parties (`{t:'friend', kind: 'request'|'accepted'|'removed'|'online'|'offline'}`)
     so an open page refetches rather than polls. Presence for friends comes
     from `hub.isConnected` (`server/src/ws/hub.ts`) and `roomForPlayer`
     (`server/src/match/rooms.ts`); on socket add/remove, tell that user's
     friends `online`/`offline` (debounce the offline by a few seconds so a
     reload does not flicker).
2. **Play with a friend.** From the friends list: `POST /api/friends/:userId/invite`
   with `{kind: 'challenge'|'home', mode?, rated?, speed?}`. A challenge invite
   creates a challenge link through the existing `server/src/challenges.ts`
   code (do not build a second match path) and pushes
   `{t:'invite', id, from: UserSummary, kind, url, expiresAt}` to the friend;
   a home invite does the same for an existing or new home game the host is in.
   On the client, an invite anywhere on the site is a `window.g.toast` with one
   action ("Play") that goes to the link's page, where the existing accept
   flow seats both players; the sound module plays the existing match-found
   cue. Pending invites also list on the friends page and the home card, so a
   dismissed toast is not a lost invite. An invite lives as long as its link.
3. **Home card.** `FriendsCard` in the `.home-under` slot of
   `client/src/routes/home.tsx` (the `{/* FriendsCard */}` comment is your
   place; leave the `{/* TournamentsCard */}` comment where it is, another
   branch fills it). Online friends first with a presence dot and what they are
   doing ("Playing", "At the table you are watching", "Online"), then the
   rest by last seen; each row has a small Play button (challenge, heads-up,
   the player's pinned speed) and pending requests show at the top with
   Accept and Decline. Empty state: one calm sentence and an "Add a friend"
   control that takes a name. Signed-out or guest: the same card offers the
   account prompt. Cap the card at eight rows with a "All friends" link.
4. **Friends page** `/friends`: the full list, requests in and out, invites,
   an add-by-name field, and "People you have played" (last 20 distinct human
   opponents from `match_players`, each with an Add control) because that is
   where friends actually come from on a poker site.
5. **Profile and table.** On `/u/:name`: Add friend / Request sent /
   Friends (with Remove in a menu) / Accept request, and a Challenge button
   when friends and online. In the heads-up match summary
   (`client/src/table/match-summary.tsx` or `result-panel.tsx`, read them),
   an "Add friend" control beside the opponent when they are a human account.
6. **Top bar.** A count badge on a Users icon in the shell when there are
   pending incoming requests or invites, linking to `/friends`.
7. Tests: server tests for the request/accept/decline/unfriend state machine,
   the guest and bot refusals, the caps, presence in `GET /api/friends`, the
   invite push and its link. A Playwright script that drives two browser
   contexts through request, accept, invite, and both landing at one table.
8. Docs: root `CLAUDE.md` Decisions bullet ("Friends are claimed accounts
   only ...", why), `server/src/CLAUDE.md`, `client/src/routes/CLAUDE.md`,
   `client/src/ui/CLAUDE.md` where you touched them.

## Out of scope
Blocking, direct messages, notifications inbox, tournaments (another branch),
anything that changes matchmaking or ratings.
