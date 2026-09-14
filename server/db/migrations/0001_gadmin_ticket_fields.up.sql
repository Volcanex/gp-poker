-- g-admin ticket fields. This is the same change schema.sql applies
-- automatically on every boot (see the block above `-- g-admin` there); this
-- file exists only as the numbered, manually-runnable pair schema.sql's own
-- header comment calls for wherever a change needs an explicit down. Applying
-- this against a database schema.sql has already brought up to date is a
-- no-op, like schema.sql itself.

alter table tickets add column if not exists updated_at timestamptz;
update tickets set updated_at = created_at where updated_at is null;
alter table tickets alter column updated_at set not null;
alter table tickets alter column updated_at set default now();

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

alter table tickets add column if not exists source text;
update tickets set source = 'human' where source is null;
alter table tickets alter column source set not null;
alter table tickets alter column source set default 'human';

alter table tickets add column if not exists baked_by text;

update tickets set status = 'baked' where status = 'done';
