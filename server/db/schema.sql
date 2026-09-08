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
