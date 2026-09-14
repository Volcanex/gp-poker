# db

`schema.sql` is the one file `applySchema()` (`../src/db.ts`) actually runs,
idempotently, inside a transaction, on every boot. Additive changes
(a new table, a new column with a default, a backfill written as
`insert ... on conflict do nothing` or an idempotent `update`) go straight in
there, in order, the way every change here has since v1.

`migrations/` is the "numbered migration file" `schema.sql`'s own header
comment has always promised for anything destructive, first used for
`0001_gadmin_ticket_fields`. It exists **only** as a manually-runnable,
reversible record of a change `schema.sql` also applies automatically -
`applySchema()` never reads this directory, so a migration pair here does
nothing on its own at boot. Run one by hand (`psql $DATABASE_URL -f
migrations/000N_name.up.sql`) if a deploy needs undoing before the next boot's
`schema.sql` would otherwise re-assert the change, or to prove a change is
reversible before it ships (numbered pairs are meant to be tested against a
scratch database, never the live one or `TEST_DATABASE_URL`, which the suite
already owns).

A pair is `000N_name.up.sql` / `000N_name.down.sql`. The up file mirrors
exactly what `schema.sql` applies for that change; the down file reverses it,
documenting any place that reversal is lossy (a status value with no
equivalent in the shape being rolled back to, for instance) in a comment
rather than pretending it is not.
