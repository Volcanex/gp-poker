# chat

Table chat. `chat.ts` is the pure half (the send cooldown, the unread count,
relative time, appending without duplicating a replayed line), `use-chat.ts`
owns the state for a live table and for the mock, and `chat.tsx` is the panel
and the toggle that goes in the hand header.

## The panel is never a row of `.match`'s grid

That is the whole rule, and `../../e2e/chat.spec.ts` measures it at both widths:
opening, sending and closing leave the header, the felt and the dock in byte
identical boxes (see `../table/CLAUDE.md`). Where the felt leaves a gutter beside
it the panel shares the felt's own row (`grid-row: 3`, `justify-self: end`) and
sits in that gutter; anywhere narrower it is a sheet fixed over the felt and
above the dock.

There are two thresholds because there are two felts: 680px heads-up needs
1240px of container, 960px six-max needs 1520px, and below its own threshold
each keeps the sheet rather than laying a column over a seat.

## The toggle goes at the end of the header's row

So the unread count can arrive and grow without moving anything that was already
on it, and its slot is held open whether or not there is a number in it.

## Two channels, drawn as told

A spectator's line is drawn quieter and marked "watching", because a spectator
sees both channels and two conversations in one list have to be told apart. The
server decides which channel a message is on; the panel only draws what it is
sent. `ChatFrom.seat` being null is both "who said it" and "where it lands".

The cooldown on the send button counts down `CHAT_MIN_GAP_MS` **from
`@opentable/protocol`**, the same constant the server refuses against. Two
copies of that number drift and the countdown starts lying, the same reason
`HAND_HOLD_MS` lives there.

`/m/mock` drives the same panel from `mockChat()` with no server behind it,
which is how the toggle is measured without a live table.
`../test/chat.test.ts` covers the pure half.
