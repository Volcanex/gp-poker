# Agent kickoff: adopt g-admin (first consumer)

You are an agent in a git worktree off `main` in `opentable`. Read the
root CLAUDE.md for deploy rules. The binding contract is
`/home/gabriel/g-system/agents/g-admin-contract.md`. Prerequisites: the
g-system client and reference server briefs have merged (dist ships
`g-admin.js`/`g-admin.css`).

## The goal

Replace this repo's bespoke annotation system with the vendored
g-admin overlay, and adapt the existing ticket backend to the contract.
This is the proving ground for the whole tool.

## Deliverables

- Vendor the g assets: `node /home/gabriel/g-system/scripts/vendor.mjs`
  into this project's static dir; serve `g-admin.js`/`.css` alongside.
- Server (TypeScript, `server/src/`): implement the contract endpoints
  under `/api/gadmin/*`, backed by the existing Postgres `tickets`
  table — migrate it: add `scope`, `kind`, `severity`, `edits` (jsonb),
  `replies` (jsonb), `baked_by`; keep `drawing` and the
  exclude-drawing-from-lists rule. Gate with the existing
  `requireAdmin()` (`server/src/auth.ts:147`). Add the `X-Gadmin-Token`
  path per the contract (`GADMIN_TOKEN` env var).
- `GET /api/gadmin/tickets/{id}/brief` — markdown brief per the
  contract.
- `GET /api/gadmin/overrides.css` and link it after the app styles:
  this project runs with `GADMIN_REAPPLY=1` — unbaked edits re-apply
  on reload here by design.
- Delete the replaced client code: `client/src/admin/annotate.tsx`,
  `bar.tsx`; keep `tickets.tsx` admin pages but point them at the new
  endpoints and new fields. Existing open tickets migrate, not reset.
- Trim `server/src/admin.ts` to whatever the new module doesn't cover;
  remove dead routes.

## Constraints

- No behaviour change for players: nothing about the admin layer on
  the wire for non-admins (the current code already gets this right —
  keep it true).
- Do not restart the production service; deploy rules in root
  CLAUDE.md apply.
- Migration must be reversible (write the down migration).

## Acceptance

- Full existing test suite passes; new tests for the gadmin routes.
- Manual pass recorded in the PR: arm with `?gadmin=1`, annotate an
  element with a note, make a token-snapped spacing edit, save both,
  see them at `/admin/tickets`, pull the brief, PATCH one to baked,
  confirm its override rule disappears from overrides.css.
- Old annotation files gone; CLAUDE.md files pruned accordingly.
