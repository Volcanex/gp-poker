# admin

The admin layer: a bar, an annotation mode and the tickets it writes. It exists
so noticing that something is wrong and filing it are the same gesture, on the
page it is wrong on, with the context attached rather than remembered.

Everything here is gated on `me.admin`, which `/api/me` only sends to the one
account that has the column. See `../../../server/src/CLAUDE.md` for the gate
and the ticket shape.

| File | What |
| --- | --- |
| `bar.tsx` | the 28px bar above `.top`, the shortcut, and the lazy handle on the overlay |
| `annotate.tsx` | the overlay: the highlighter, the pen, the note and the save |
| `tickets.tsx` | `/admin/tickets` and `/admin/tickets/:id` |
| `admin.css` | all three, tokens only |

## Nothing admin reaches anyone else

`AdminBar` returns null for a player, so the bar is not a hidden node, it is not
a node. The overlay is a lazy chunk loaded on the first annotation, and both
ticket pages are lazy routes registered in `../app.tsx` beside the replay, so
none of this is in the bundle everybody downloads to play. A player who guesses
`/admin/tickets` gets `../routes/not-found.tsx`, the same page a dead link
gets: "you are not allowed here" and "there is nothing here" should look the
same to somebody who was never meant to find it.

`NotFound` lives in `../routes/not-found.tsx` rather than in `../app.tsx` for
exactly that reuse. Importing it out of `app.tsx` would have put the whole app
module in the admin chunk's import graph.

## The overlay takes every pointer event

The highlighter reads the element under the pointer with
`document.elementsFromPoint`, skipping anything inside the overlay's own root.
That only works because the overlay covers the viewport and consumes the
gesture: the page underneath is a picture for as long as annotation mode is up,
so a click cannot be both "highlight this" and whatever the page does with a
click. Page scroll is locked for the same reason, one step further on. **Every
box stored on a target is in viewport coordinates**, and a scroll under the
overlay would leave them pointing at the wrong thing the moment they were read
back.

The canvas is sized in device pixels and scaled back, so a stroke is a stroke
rather than a staircase on a retina screen. The stroke colour is read off the
root element with `getComputedStyle`, because a canvas cannot resolve a custom
property and the accent has to come from the token like everything else.

The two tools answer different questions and a ticket usually carries both. The
highlighter says *which element*, as a selector, a box and the text in it, which
is what a fix needs to find it again. The pen says *what about it*, which no
selector can say.

## The shortcut

Cmd+Shift+K on a Mac, Ctrl+Shift+K everywhere else, read off
`navigator.platform`. It is deprecated and still the only thing that answers
this without guessing at a user-agent string. The listener is bound only for an
admin, and it deliberately **does not** use `isTextEntry` from `../ui/bits.tsx`:
that guard is for single-key shortcuts, and the thing being annotated is often
the field that has focus.

## The open count

The bar's badge is the length of the open list, refetched on a
`ot:ticket-saved` window event that both the overlay and the tickets page
dispatch. A window event rather than shared state because there is one producer
and one consumer, and the producer is usually not mounted.
