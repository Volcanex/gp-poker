# admin

The g-admin ticket pages: `/admin/tickets` and `/admin/tickets/:id`. The bar,
the annotate mode and the edit mode that used to live here are gone -
replaced by g-system's vendored g-admin overlay (`agents/g-admin-contract.md`
at the repo root, `client/public/g/g-admin.js`/`.css`, injected by the stub
inside `g-ui.js`). Arm it with `?gadmin=1` on any page, or the `off` control
in its own bar clears `localStorage['g-admin']` again. **Nothing writes to
source**: every saved annotation or edit becomes a ticket
(`server/src/gadmin.ts`), and a baking agent applies it afterwards, guided by
`/api/gadmin/tickets/:id/brief`.

| File | What |
| --- | --- |
| `tickets.tsx` | `/admin/tickets` and `/admin/tickets/:id`: review what the overlay has written, filter by status, dismiss or reopen, pull a brief |
| `admin.css` | tokens only, for the two pages above |

Everything here is gated on `me.admin`, which `/api/me` only sends to the one
account that has the column - see `../../../server/src/CLAUDE.md`. The
overlay's own gate is separate: its stub fetches `/api/gadmin/verify`
independently, so a page never needs `me.admin` to decide whether to inject
it.

## Nothing admin reaches anyone else

Both ticket pages are lazy routes registered in `../app.tsx` beside the
replay, so neither is in the bundle everybody downloads to play. A player who
guesses `/admin/tickets` gets `../routes/not-found.tsx`, the same page a dead
link gets: "you are not allowed here" and "there is nothing here" should look
the same to somebody who was never meant to find it.

`NotFound` lives in `../routes/not-found.tsx` rather than in `../app.tsx` for
exactly that reuse. Importing it out of `app.tsx` would have put the whole
app module in this chunk's import graph.

## Status is open, baked or dismissed

Baking is the brief flow's job: an agent reads `/brief`, applies the change
to source, and PATCHes the ticket to `baked` with a reply describing the
commit. This page can only move a ticket between `open` and `dismissed` - a
baked ticket shows a plain badge here, not a button, because clicking
something on this page was never what baked it.

## Server-side field names are snake_case

`net/types.ts`'s `Ticket`/`TicketSummary` (and the nested `page`, `viewport`,
`elements`, `edits` shapes) mirror the contract's own JSON exactly, unlike
this codebase's usual camelCase, because it is the one wire shape shared with
gcommand's tickets panel and a baking agent's own `/brief` fetch. See
`../../../server/src/gadmin.ts` for why the table underneath still stores
those same fields camelCase.
