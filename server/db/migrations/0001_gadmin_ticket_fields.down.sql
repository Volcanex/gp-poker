-- Reverses 0001_gadmin_ticket_fields.up.sql. Lossy in one place only: a
-- ticket baked or dismissed since the up migration ran has no 'done'/'open'
-- equivalent, so both fold back to 'done', the closest the old two-value
-- status ever had to either. Nothing else here can lose data the up
-- migration didn't itself just add.

update tickets set status = 'done' where status in ('baked', 'dismissed');

alter table tickets drop column if exists baked_by;
alter table tickets drop column if exists source;
alter table tickets drop column if exists replies;
alter table tickets drop column if exists edits;
alter table tickets drop column if exists severity;
alter table tickets drop column if exists kind;
alter table tickets drop column if exists scope;
alter table tickets drop column if exists updated_at;
