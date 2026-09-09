import type { TableView } from '@opentable/protocol';

/* Sitting out, as the band has to read it. Pure and on its own so it can be
   tested without a felt, and so the words and the rule for when they are shown
   sit next to each other rather than a component apart. */

/* Two things in one line, because the second is the only thing worth doing
   about the first. The band says nothing else about it: the button under
   these words is the press. */
export const SITTING_OUT_TEXT = 'You are sitting out. Press to come back';

/* Whether the band should stand the sit-out prompt in front of its controls.

   It goes in front of your turn and of waiting, because while it is true
   neither of those is the thing you have to know. It does **not** go in front
   of the hand being over: who won is worth reading, and the prompt is back on
   screen the moment the next hand deals. A spectator has no seat to sit out. */
export function sittingOutNow(view: TableView, handOver: boolean): boolean {
  if (view.you == null || handOver) return false;
  return view.seats.find((s) => s.i === view.you)?.sittingOut === true;
}
