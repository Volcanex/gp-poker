import type { TableView } from '@opentable/protocol';

/* What the felt is saying out loud, one line at a time.

   The board owns the top of the felt and this owns the bottom. It is the
   **table's** voice, not yours: whose action it is and what they are facing
   ("riverrat to call 40"), and when the hand is over, who won it and how
   ("kestrel wins 132 with flush, king high"). The band's own decision line
   above the clock keeps the second person and the price you have to answer
   ("34 to call"); saying the same fact twice in two grammars is what the
   band's one-line rule was written to stop, so **everybody is named here,
   including you**. It is also the grammar the owner used filing it.

   Pure and on its own so `../test/table.test.ts` can test the words without a
   felt, the way `sitout.ts` and `collect.ts` are. What the felt does with the
   answer, and the typing of it, is in `table.tsx`.

   No namer of its own. A showdown's hand comes off the award the engine sent
   (`phe`'s description, Title Case, lowercased at the display site like every
   other reading of it), so this file cannot drift from `best-five.ts` or from
   what the seats and the result panel say. */

export interface FeltReading {
  /* How much of the board the felt has actually dealt (`useDealt` in
     `table.tsx`). While the pot collects, the wire is a street ahead of the
     table, and the bar narrates the street the player can see. */
  onTable: number;
  /* Which step of the hand-end sequence the felt is on: 0 while the cards are
     still turning over, 1 once the winning five is outlined, 2 once the chips
     have moved. Who won is not said before the felt has shown why. */
  phase: number;
}

/* **Null is not the empty line.** It means the table has nothing *new* to
   say, and the bar keeps the line it is already holding: between two streets,
   through the collect beat, while a run-out's count ticks. A bar that blanked
   in those gaps would retype the same sentence two or three times a hand,
   which is the one thing a typewriter must not do. */
export function narrationLine(view: TableView, felt: FeltReading): string | null {
  if (view.street === 'done' && view.result) {
    return felt.phase < 1 ? null : winnerLine(view);
  }
  /* The felt is still on the last street: the cards that would justify a new
     line are not on the table yet (`collect.ts`), and a seat may not be
     narrated as acting on a street the player cannot see. */
  if (felt.onTable < view.board.length) return null;
  const acting = view.seats.find((s) => s.acting);
  if (acting) return actingLine(view, acting);
  /* Nobody has a decision left and the board is being dealt out behind a
     count. The award zone counts the streets; this says why nobody is acting. */
  if (view.runout) return 'All in, running out the board';
  return null;
}

/* Who is to act and what it costs them. The price is read off the seats, the
   way `amountToCall` reads yours: `legal` exists only on your own turn and
   this line is about everybody. An all in to call is named rather than
   numbered, which is what the band already does with the same spot, because
   the figure alone does not say it is the whole stack. */
function actingLine(view: TableView, acting: TableView['seats'][number]): string {
  const high = view.seats.reduce((m, s) => Math.max(m, s.bet), 0);
  const call = Math.max(0, high - acting.bet);
  if (call <= 0) return `${acting.name} to act`;
  if (call >= acting.stack) return `${acting.name} to call all in`;
  return `${acting.name} to call ${call}`;
}

/* Who won what, and with what. Awards are summed per seat first: a main pot
   and a side pot are two awards to one player and one sentence about them,
   and printing their name twice in a row reads as a bug. A pot that was
   genuinely split names both, joined with "and", the way the result line
   above the band joins them. A hand nobody showed carries no description, so
   the clause is simply not there: "kestrel wins 40". */
function winnerLine(view: TableView): string {
  const awards = view.result?.awards ?? [];
  if (awards.length === 0) return 'The hand is over';
  const name = (seat: number) => view.seats.find((s) => s.i === seat)?.name ?? `seat ${seat}`;

  const won: { seat: number; amount: number; hand?: string }[] = [];
  for (const a of awards) {
    const had = won.find((w) => w.seat === a.seat);
    if (had) {
      had.amount += a.amount;
      had.hand = had.hand ?? a.hand;
    } else {
      won.push({ seat: a.seat, amount: a.amount, hand: a.hand });
    }
  }

  return won
    .map((w) => `${name(w.seat)} wins ${w.amount}`
      + (w.hand ? ` with ${w.hand.toLowerCase()}` : ''))
    .join(' and ');
}
