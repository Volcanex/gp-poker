-- Open Table schema. Applied idempotently on server start (every statement
-- is IF NOT EXISTS). Additive changes go here; anything destructive gets a
-- numbered migration file beside this one.

create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_lower text not null unique,
  password_hash text,                          -- null while the account is a guest
  guest boolean not null default true,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- Glicko-2 state, lifetime, no seasonal reset
  rating double precision not null default 1500,
  rd double precision not null default 350,
  volatility double precision not null default 0.06,
  rating_at timestamptz not null default now(), -- when rd was last settled; inactivity widens from here
  peak_rating double precision not null default 1500,
  peak_at timestamptz,
  matches int not null default 0,
  wins int not null default 0,
  losses int not null default 0,
  draws int not null default 0
);

create table if not exists sessions (
  token text primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists sessions_user on sessions(user_id);

create table if not exists matches (
  id text primary key,                         -- short public id, the shareable URL
  format jsonb not null,                       -- MatchFormat
  rated boolean not null default true,
  seats jsonb not null,                        -- [{seat, user_id, name}] seat 0 and 1
  status text not null default 'playing',      -- playing | finished | aborted
  winner uuid references users(id),
  reason text,                                 -- bust | hands | forfeit | draw | abort
  hands_played int not null default 0,
  final_stacks jsonb,                          -- {user_id: stack}
  ratings jsonb,                               -- {user_id: {before, after, rdBefore, rdAfter}}
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists matches_created on matches(created_at desc);

create table if not exists match_players (
  match_id text not null references matches(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  seat int not null,
  primary key (match_id, user_id)
);
create index if not exists match_players_user on match_players(user_id);

create table if not exists hands (
  id text primary key,                         -- '<match_id>-<number>'
  match_id text not null references matches(id) on delete cascade,
  number int not null,
  seed_hash text not null,                     -- sha256(seed), published before the deal
  seed text,                                   -- published when the hand completes
  button int not null,
  stacks_start jsonb not null,                 -- [stack per seat]
  actions jsonb not null default '[]',         -- LoggedAction[]
  board text[] not null default '{}',
  holes jsonb,                                 -- {seat: [c, c]} for every seat, filled at completion
  result jsonb,                                -- HandOutcome
  stats jsonb,                                 -- {seat: {vpip, pfr, aggr, passive, faced3bet, foldTo3bet}}
  study jsonb,                                 -- {seat: {decisions: [...], evLost, accuracy}}
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (match_id, number)
);

create table if not exists rating_history (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  match_id text references matches(id) on delete set null,
  rating double precision not null,
  rd double precision not null,
  at timestamptz not null default now()
);
create index if not exists rating_history_user on rating_history(user_id, at);

-- Raw connection and timing log, kept so bot and collusion detection can be
-- built later without a schema change. Nothing reads it yet.
create table if not exists audit_log (
  id bigserial primary key,
  user_id uuid,
  match_id text,
  kind text not null,                          -- connect | disconnect | act | timeout | queue
  detail jsonb,
  ip inet,
  at timestamptz not null default now()
);
create index if not exists audit_log_match on audit_log(match_id);

-- Additive columns for protocol v2 (modes, multiway, bots). Kept as separate
-- alters rather than folded into the create-table blocks above so an existing
-- database picks them up on the next boot.
alter table users add column if not exists bot boolean not null default false;
-- 1..5 on a bot, null on everyone else. Set from the roster on every boot, so
-- a level change in code lands on the existing accounts rather than needing
-- new ones.
alter table users add column if not exists bot_level smallint;
alter table matches add column if not exists places jsonb;            -- {user_id: place}, 1 = winner
alter table match_players add column if not exists place int;
-- Table seats that were dealt into this hand, in engine-seat order. The
-- action log, holes and result are stored in TABLE seats; this is what turns
-- them back into an engine HandConfig for replay.
alter table hands add column if not exists live_seats int[];

-- Per-mode Glicko-2 state. Ratings are kept apart by mode the way a chess
-- site keeps bullet and blitz apart: a six-max result never moves a heads-up
-- rating. A missing row is a player who has not played that mode yet and
-- reads as a fresh 1500/350/0.06.
create table if not exists ratings (
  user_id uuid not null references users(id) on delete cascade,
  mode text not null,                          -- heads-up | six-max
  rating double precision not null default 1500,
  rd double precision not null default 350,
  volatility double precision not null default 0.06,
  rating_at timestamptz not null default now(), -- when rd was last settled; inactivity widens from here
  peak_rating double precision not null default 1500,
  peak_at timestamptz,
  matches int not null default 0,
  wins int not null default 0,
  losses int not null default 0,
  draws int not null default 0,
  primary key (user_id, mode)
);
create index if not exists ratings_mode on ratings(mode, rating desc);

alter table rating_history add column if not exists mode text not null default 'heads-up';

-- One-shot backfill: everything on users before the split was heads-up. Runs
-- on every boot and does nothing after the first, which keeps schema.sql the
-- only migration path there is.
insert into ratings (user_id, mode, rating, rd, volatility, rating_at, peak_rating, peak_at, matches, wins, losses, draws)
select id, 'heads-up', rating, rd, volatility, rating_at, peak_rating, peak_at, matches, wins, losses, draws
from users
on conflict (user_id, mode) do nothing;

-- Challenge links: "play a friend". One row per link, created when someone
-- asks for one and spent the moment the friend opens it and accepts. Status
-- is only ever open, accepted or cancelled: an expired link is derived from
-- expires_at when the row is read, so nothing has to sweep the table and a
-- row can never sit here claiming a status only a cron job would have made
-- true.
create table if not exists challenges (
  id text primary key,                         -- short public id, the shareable URL
  creator_id uuid not null references users(id) on delete cascade,
  mode text not null,                          -- heads-up | six-max
  rated boolean not null default true,
  status text not null default 'open',         -- open | accepted | cancelled
  accepted_by uuid references users(id) on delete set null,
  match_id text references matches(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
-- The cap on open links per person is counted on every create, so it is the
-- one query this table is read by other than the link's own page.
create index if not exists challenges_creator on challenges(creator_id, status);

-- Table chat. The room keeps the last messages in memory and replays them on
-- join; this is the durable copy, written so a report about what was said at a
-- table has something to read. Nothing reads it yet, on purpose: moderation is
-- a tool to be built, not a route to leave open. `seat` is the sender's table
-- seat, null for a spectator, which is also which channel the line was on.
create table if not exists chat (
  id bigserial primary key,
  match_id text not null references matches(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  seat int,
  text text not null,
  at timestamptz not null default now()
);
create index if not exists chat_match on chat(match_id, at);

-- Home games: the six-max version of a challenge link. One row per private
-- table, created when a host asks for one and spent when they start it. The
-- host holds a seat like anybody else, so `home_game_seats` is the whole
-- guest list and the host is simply the row that matches `host_id`. Status is
-- only ever open, started or cancelled: an expired lobby is derived from
-- expires_at at read time, exactly as a challenge link's is, so nothing has
-- to sweep this table either.
create table if not exists home_games (
  id text primary key,                         -- short public id, the shareable URL
  host_id uuid not null references users(id) on delete cascade,
  rated boolean not null default true,         -- what the host asked for; two humans is what grants it
  bot_level smallint not null default 4,       -- 1..5, the level any empty seat is filled at
  status text not null default 'open',         -- open | started | cancelled
  match_id text references matches(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists home_games_host on home_games(host_id, status);

create table if not exists home_game_seats (
  game_id text not null references home_games(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (game_id, user_id)               -- one seat per person per lobby
);
-- The lobby is read in join order, which is the order the seats fill in.
create index if not exists home_game_seats_game on home_game_seats(game_id, joined_at);

-- Arenas: a half-hour heads-up event on every hour, the competitive loop this
-- site did not have. A row per event, created ahead of time by the scheduler
-- (server/src/arena.ts) rather than by an admin, so there is always a next one
-- to join. Status is stored rather than derived, unlike a challenge link's,
-- because finishing an arena is an event with work in it: the standings are
-- frozen, places are written and the podium is recorded. `podium` is the top
-- three as they stood at the end, kept on the row so a finished arena reads
-- without a join.
create table if not exists arenas (
  id text primary key,                         -- short public id, the shareable URL
  name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'upcoming',     -- upcoming | running | finished
  podium jsonb,                                -- [{uid, name, score, place}], written at the end
  created_at timestamptz not null default now()
);
create unique index if not exists arenas_starts on arenas(starts_at);

-- One row per person in an arena. The counters are kept here rather than
-- derived from the matches, unlike everything else on this site, because an
-- arena's score is not a function of its matches alone: the streak bonus makes
-- each result depend on the ones before it, and a board that is recomputed
-- from scratch on every finish is a board that pays to say the same number.
-- `paused` is the Lichess pause: a player who is here but not to be paired.
create table if not exists arena_players (
  arena_id text not null references arenas(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  score int not null default 0,
  wins int not null default 0,
  losses int not null default 0,
  draws int not null default 0,
  streak int not null default 0,               -- consecutive wins, reset by a draw or a loss
  matches int not null default 0,
  paused boolean not null default false,
  place int,                                   -- written when the arena ends, 1 = winner
  primary key (arena_id, user_id)
);
create index if not exists arena_players_board on arena_players(arena_id, score desc);

-- The admin flag. One person has it, and what it unlocks is the annotation
-- layer and the tickets it writes: a way to point at a broken thing on the
-- page it is broken on. Nothing about the game reads it.
alter table users add column if not exists admin boolean not null default false;

-- Gabriel's account, granted here rather than by a statement somebody runs by
-- hand, so a fresh database and a deploy both end up with an admin without
-- anyone touching the live rows. Guarded on `admin = false`, so it is a no-op
-- on every boot after the first and a revoke made deliberately elsewhere
-- would be undone only by a deploy, which is where a grant belongs.
update users set admin = true
where id = '4ed2aa44-08b7-414e-a88a-9e337b190ad5' and admin = false;

-- Tickets: an annotation made on the running site. The note is what is wrong,
-- `targets` is the elements that were pointed at (selector, box, text) and
-- `drawing` is the strokes drawn over them as a PNG data URL. The context is
-- stored with the note because a bug report written a day later cannot
-- reconstruct the viewport it was seen at. `page_shot` is the slot for a
-- capture of the page itself, which nothing writes yet.
create table if not exists tickets (
  id text primary key,                         -- short public id, like a match's
  created_at timestamptz not null default now(),
  user_id uuid not null references users(id) on delete cascade,
  url text not null,                           -- the full URL the note was made on
  path text not null,                          -- its pathname, which is what a list reads
  title text not null,                         -- the note's first line, trimmed to 120
  note text not null,
  viewport jsonb not null,                     -- {width, height, dpr, theme}
  targets jsonb not null default '[]',         -- [{selector, rect, text, label}]
  drawing text,                                -- PNG data URL of the strokes layer
  page_shot text,                              -- unused for now, see above
  status text not null default 'open',         -- open | done
  build text                                   -- the client build this was seen on
);
create index if not exists tickets_status on tickets(status, created_at desc);
-- Profile pictures. The bytes live on the row rather than on disk: there is one
-- box, one backup path (pg_dump), and a 120 KB square per player is nothing
-- beside the hand histories. `avatar_v` is bumped on every change, including a
-- removal, so `/api/avatars/:id?v=N` can be served immutable and a new picture
-- reaches every open page as a different URL rather than as a cache to bust.
-- Zero means no picture, which is what every payload carrying a display name
-- reports when there is none.
--
-- **The bytes are never selected by `select *`.** `server/src/db.ts` lists the
-- user columns explicitly for exactly this reason: a session lookup runs on
-- every request and must not drag an image through the driver.
alter table users add column if not exists avatar bytea;
alter table users add column if not exists avatar_type text;
alter table users add column if not exists avatar_v integer not null default 0;
-- The flag a player chose to put beside their name: a lowercase ISO 3166-1
-- alpha-2 code, or null for no flag, which is the default and stays the
-- default. Nothing infers it from an address or a request header: it is
-- something a player says about themselves, and guests may say it too.
-- Validated against server/src/countries.ts before it is written here.
alter table users add column if not exists country char(2);

-- The blinds this hand was actually dealt at. Derived until speed existed:
-- the level was a function of the hand number, so anything reading a stored
-- hand could recompute it. A short format climbs its schedule on elapsed match
-- time instead, which is a thing only the room that dealt the hand knew, so
-- the answer is recorded rather than re-derived. Null on every hand written
-- before this, which is what `handBlinds` in server/src/db.ts falls back from.
alter table hands add column if not exists sb int;
alter table hands add column if not exists bb int;

-- Walkouts: leaving a ranked match early, either by choosing to (the table's
-- leave control) or by having it taken (three timeouts, or a connection that
-- never came back). Persisted rather than held in memory like the ready
-- check's cooldown, because a penalty a deploy wipes is not a penalty.
--
-- `walkout_strikes` is the count as it stood at `walkout_at`, and nothing
-- sweeps it: strikes decay at one a day and the decay is applied on read by
-- `walkoutStrikesNow` in @opentable/protocol, so the stored pair is a
-- statement about a moment rather than a running total needing a cron.
-- `ranked_ban_until` is what the ladder charged for the strike that was
-- current when it was written; null means no ban has ever been charged.
alter table users add column if not exists walkout_strikes int not null default 0;
alter table users add column if not exists walkout_at timestamptz;
alter table users add column if not exists ranked_ban_until timestamptz;

-- The speed a challenge link deals at. Links predate speed and every one of
-- them was standard, which is what `speedOf` reads a stored format with no
-- speed as, so null here means the same thing and nothing has to be
-- backfilled. It is a column rather than a thing the accepter chooses because
-- the link is the offer: the page says what table it opens before anybody
-- presses the button, and an invite made from a friends list carries the
-- speed that list's owner plays at.
alter table challenges add column if not exists speed text;

-- Friends. One row per pair, and the row remembers which way round it was
-- asked because that is what tells a request from an offer: `requester_id`
-- asked, `addressee_id` has yet to answer while the status is pending.
-- Status is only ever pending or accepted. A decline, a cancel and an unfriend
-- all delete the row, because none of them is a state anybody should be shown
-- later: a declined request that stayed on the table would be a rejection
-- somebody has to look at, and the person who asked can simply ask again.
--
-- Both sides are claimed accounts. A guest's name is generated and its row
-- may never be seen again, so a friendship with one is a friendship with
-- nobody; the routes refuse it rather than the column, since `users.guest`
-- is the fact and a check constraint here could not read it. Bots are refused
-- the same way.
create table if not exists friendships (
  requester_id uuid not null references users(id) on delete cascade,
  addressee_id uuid not null references users(id) on delete cascade,
  status text not null default 'pending',      -- pending | accepted
  created_at timestamptz not null default now(),
  responded_at timestamptz,                    -- when it was accepted, null while pending
  primary key (requester_id, addressee_id)
);
-- The unordered pair, so two rows can never describe one friendship: A asking
-- B and B asking A are the same edge, and the second insert is a unique
-- violation rather than a duplicate the reads would have to reconcile.
create unique index if not exists friendships_pair
  on friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
-- Incoming requests and the friends list read from the other end of the pair,
-- which the primary key's leading column cannot serve.
create index if not exists friendships_addressee on friendships(addressee_id, status);

-- Invites: a friend has made you a table. The invite is a link plus the name
-- of who it is for, and nothing else: the match path is the challenge or the
-- home game it points at, so there is no second way to seat two people and
-- nothing here decides anything about the game.
--
-- `link_id` is a `challenges.id` or a `home_games.id` by `kind`, and carries
-- no foreign key because it points at one of two tables. That is also what
-- makes an invite need no sweeper: whether it is still worth anything is read
-- off the link's own status and `expires_at`, exactly as the link's page reads
-- it, and an invite whose link has gone reads as spent.
--
-- The key is (recipient, kind, link) rather than an id of its own: one invite
-- per person per link is the rule, and a host inviting three friends to one
-- home game is three rows, which is what the lobby is for.
create table if not exists friend_invites (
  to_id uuid not null references users(id) on delete cascade,
  kind text not null,                          -- challenge | home
  link_id text not null,                       -- challenges.id or home_games.id, by kind
  from_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (to_id, kind, link_id)
);
create index if not exists friend_invites_from on friend_invites(from_id, created_at desc);
-- Tournaments: a field that funnels up to a final, on a fixed calendar. Three
-- fixtures and no admin, the way arenas have none: the scheduler creates each
-- kind's next row as soon as the previous one starts, so there are at most
-- three upcoming and never zero.
--
-- `kind` names the fixture (which is what the calendar in
-- server/src/tournaments/fixtures.ts is keyed by) and `shape` says how it is
-- played. Both are stored rather than looked up from the kind at read time,
-- because a stored tournament is a record of what was played and a fixture
-- whose shape or seat cap is changed later must not rewrite history.
--
-- `starts_at` is unique per kind, so two processes scheduling the same fixture
-- produce one row, exactly as `arenas.starts_at` does.
create table if not exists tournaments (
  id text primary key,                         -- short public id, the shareable URL
  kind text not null,                          -- daily-bracket | sunday-shootout | monthly-championship
  shape text not null,                         -- bracket | shootout
  mode text not null,                          -- heads-up | six-max
  name text not null,
  seats int not null,                          -- the cap on the field
  starts_at timestamptz not null,
  status text not null default 'upcoming',     -- upcoming | running | finished | cancelled
  round int not null default 0,                -- the round in play, 0 before the start
  podium jsonb,                                -- [{uid, avatarV, name, place}], written at the end
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create unique index if not exists tournaments_kind_start on tournaments(kind, starts_at);
create index if not exists tournaments_status on tournaments(status, starts_at);

-- One row per person registered. Registration opens when the tournament row is
-- created and closes at the start; withdrawing before the start deletes the
-- row, because somebody who is not playing is not in the field.
--
-- `withdrawn` is the other kind of leaving: silence or a decline at a round's
-- ready check takes a player out of a tournament they are already in, and they
-- still have a place to be given, so the row stays and is marked. `seed` and
-- `rating` are written once, at the start: a seeding is a claim about the
-- moment the tournament began.
create table if not exists tournament_players (
  tournament_id text not null references tournaments(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  registered_at timestamptz not null default now(),
  seed int,                                    -- 1 = top seed, written at the start
  rating double precision,                     -- their rating in the mode, frozen at the start
  place int,                                   -- written when the tournament ends
  out_round int,                               -- the round they went out in; null while still in
  withdrawn boolean not null default false,
  primary key (tournament_id, user_id)
);
create index if not exists tournament_players_user on tournament_players(user_id);

-- One table of one round. The bracket's cards and the funnel's tables are the
-- same row, which is why there is one table here and not two: a heads-up
-- bracket match is a shootout table with two seats and one advancing.
--
-- `seats` is the user ids assigned to it, in seat order, and it is written when
-- the round starts. `places` is the table's own finishing order once it has
-- been played, and `advanced` is who it took through. All three are stored
-- rather than derived from the match row, because a bye and a walkover are
-- tables with a result and no match at all.
create table if not exists tournament_tables (
  tournament_id text not null references tournaments(id) on delete cascade,
  round int not null,                          -- 1-based
  table_no int not null,                       -- 0-based within the round
  match_id text references matches(id) on delete set null,
  status text not null default 'pending',      -- pending | playing | done
  bye boolean not null default false,          -- went through with no hand dealt
  seats jsonb not null default '[]',           -- [user_id] in seat order
  places jsonb,                                -- {user_id: place at this table}
  advanced jsonb,                              -- [user_id] who went through
  primary key (tournament_id, round, table_no)
);
create index if not exists tournament_tables_match on tournament_tables(match_id);

-- g-admin (agents/g-admin-contract.md): the vendored admin overlay replaces
-- this repo's bespoke annotation layer, and the tickets it writes grow a
-- richer shape than the old bar/annotate flow needed. `url`, `path`, `title`,
-- `viewport` and `drawing` are unchanged and are what `page`/`viewport`/
-- `drawing` in the contract's ticket JSON are built from; `targets` is kept
-- under its old name and served as `elements`, since nothing about its column
-- identity needs to change for the API shape to. `updated_at` is new because
-- the contract's PATCH endpoint is the first thing here that needs to say
-- when a ticket last changed, not just when it was opened.
alter table tickets add column if not exists updated_at timestamptz;
update tickets set updated_at = created_at where updated_at is null;
alter table tickets alter column updated_at set not null;
alter table tickets alter column updated_at set default now();

-- Every existing ticket came from the annotate flow with nothing to say what
-- kind or how severe it is, so the defaults below are the sensible middle of
-- each enum, not a guess at what any one of them actually was.
alter table tickets add column if not exists scope text;
update tickets set scope = 'page' where scope is null;
alter table tickets alter column scope set not null;
alter table tickets alter column scope set default 'page';

alter table tickets add column if not exists kind text;
update tickets set kind = 'idea' where kind is null;
alter table tickets alter column kind set not null;
alter table tickets alter column kind set default 'idea';

alter table tickets add column if not exists severity text;
update tickets set severity = 'minor' where severity is null;
alter table tickets alter column severity set not null;
alter table tickets alter column severity set default 'minor';

alter table tickets add column if not exists edits jsonb not null default '[]';
alter table tickets add column if not exists replies jsonb not null default '[]';

-- Who filed it: always 'human' until something other than the browser
-- overlay is allowed to POST a ticket (the contract's token tier cannot).
alter table tickets add column if not exists source text;
update tickets set source = 'human' where source is null;
alter table tickets alter column source set not null;
alter table tickets alter column source set default 'human';

-- Who baked it: 'human' or 'agent', mirroring `source`. Null until a PATCH
-- sets status to baked.
alter table tickets add column if not exists baked_by text;

-- The status enum grows a third value (dismissed) and renames its second
-- (done -> baked, since baking into source is what "done" always meant for
-- this layer). Idempotent: a second boot finds nothing left in 'done'.
update tickets set status = 'baked' where status = 'done';
