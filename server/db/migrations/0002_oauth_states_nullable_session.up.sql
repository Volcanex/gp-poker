-- oauth_states.session_token becomes nullable. GET /auth/google/start no
-- longer mints a guest and a session for a visitor who has none (crawlers
-- followed it as a link: about 1,500 guest rows a day, 2026-10-17), so a state
-- issued to such a visitor has no session to reference. This is the same
-- statement schema.sql applies on every boot; dropping a not-null constraint
-- is a no-op once it is gone.

alter table oauth_states alter column session_token drop not null;
