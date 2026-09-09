-- Resets the bot population: deletes every population bot account
-- (users.bot = true) and, for any match played entirely between population
-- bots, the match itself. A match that also seated a human keeps its row
-- and its hand history untouched; only the bot's own match_players link and
-- rating disappear with its account, the same as deleting any other user.
--
-- NEVER RUN THIS AGAINST THE LIVE DATABASE WITHOUT CHECKING WITH GABRIEL
-- FIRST. There is no confirmation prompt: this file is a reference for what
-- a reset does, not a script wired up to run on its own. To use it:
--   psql "$DATABASE_URL" -f scripts/population-reset.sql
-- (or the equivalent against the test database while developing).
--
-- Ratings and rating_history cascade on user deletion already
-- (server/db/schema.sql); this file only has to handle the two references
-- that do not: matches.winner (no cascade, so a bot that won a mixed match
-- has to be cleared from it first) and the bot-only matches themselves,
-- which cascade-deleting the users would otherwise leave behind as empty
-- husks nobody links to.

begin;

-- Matches played only between population bots: safe to remove outright.
-- match_players cascades from this delete, and so do hands and chat
-- messages keyed to the match.
delete from matches
where id in (
  select mp.match_id
  from match_players mp
  group by mp.match_id
  having bool_and(exists (select 1 from users u where u.id = mp.user_id and u.bot = true))
);

-- A bot that won a mixed match (bot vs human) leaves the match itself in
-- place for the human's history; only the winner pointer has to be cleared
-- before the account it points to can go, since matches.winner has no
-- on-delete behaviour of its own.
update matches set winner = null
where winner in (select id from users where bot = true);

-- Cascades to ratings, rating_history, sessions, match_players (for any
-- remaining mixed-match rows), challenges and home games the bot was party
-- to.
delete from users where bot = true;

commit;
