-- Reverses 0002_oauth_states_nullable_session.up.sql. Lossy: states issued
-- with no session cannot satisfy the restored not-null constraint, so they are
-- deleted first. They live ten minutes at most, so what is lost is any
-- Google sign-in in flight at the moment this runs.

delete from oauth_states where session_token is null;
alter table oauth_states alter column session_token set not null;
