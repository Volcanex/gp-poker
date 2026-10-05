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

One threshold, because both shapes draw the same 1120px felt now that the
seats sit in two wings round the board: the panel docks at 1440px of container
and below that keeps the sheet rather than laying a column over a seat.

## Every gap is off the scale, and one thing moves

The panel is g's spacing and g's line-heights and nothing else: no raw 5s, 6s
or 2s, no ratio line-heights. The owner's note was "animations and spacing and
stuff" with a chat line circled, and this file was the one part of the table
screen sitting half a step off the 4 px grid, which reads as unfinished beside
a felt that is not.

The name and the time are separated by the row, which pushes the time to the
far end, **and by a real space in the text**: a flex row drops a whitespace-only
node between its items, so `{' '}` costs nothing on screen and stops the line
copying and reading aloud as "Gabrielnow", which is how it reached the ticket.
No glyph does that job here, and no middle dot ever will.

**The newest line is scrolled to, not jumped to.** Opening the panel lands on
the bottom of the log outright, because a panel that animated its way down a
conversation you have not read is a panel you cannot read; a line arriving
while you are watching slides, so a message you did not see arrive is not
simply there. That smooth scroll is the only animation the panel has, and
reduced motion drops it. Nothing else in here moves: the panel shares the
felt's screen, and the felt's rule is one thing at a time.

## The toggle goes at the end of the header's row

So the unread count can arrive and grow without moving anything that was already
on it, and its slot is held open whether or not there is a number in it.

**On a phone it is a round button on the felt** (`ChatFab`, bottom right,
absolute against `.match` and above the band, so it costs the grid nothing),
with the count as a small circle on its shoulder. The offset includes a
practice table's actual `--stats-h`, keeping the button above its out cards
and hit odds. There is no header row on a
phone table to hold the word: the match's actions live in the top bar's "Game"
menu there (`../table/CLAUDE.md`), and a chat toggle in a menu is a toggle
nobody sees arrive. It is not drawn while the panel is open, because the panel
is a sheet over that corner and has its own Close. `table.tsx` renders one or
the other, keyed on the same `gameMenu` that decides where the actions go.

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
