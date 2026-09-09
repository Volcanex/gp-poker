/* The table's keys, as a pure decision. `r` reaches for wherever the size is
   chosen (the dock's field, the band's sizer) and the number keys hand a preset
   to it, so the two renderings differ only in what those two words mean.

   It is pure and unit tested from `../test/` for the same reason every other
   rule on this felt is: a keyboard is the one part of a poker table nobody can
   see, and a shortcut that quietly stopped answering would be found by a player
   in a hand rather than by anyone here.

   `1` upward addresses the sizes by position, ten slots at most, which is more
   than any control draws now; the band has six and the dock six, and a key with
   no size under it does nothing. `0` is not one of them: it is the square that
   opens a size of your own.

   `r` works while typing, because it is how you get back to the field. Every
   other shortcut, `0` included, is blocked by `isTextEntry` at the call site,
   so typing 137 into the field neither folds the hand nor reopens the sizer
   under the cursor. */

import type { ActionKind, LegalActions } from '@opentable/protocol';
import { raiseShape } from './sizing.ts';
import type { Preset } from './sizing.ts';

export const PRESET_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/* The key that opens a size of your own, beside `r` and doing exactly what `r`
   does. **A key and a square, not a seventh preset**: a preset is a number and
   this is a way to a number, so routing it through the same door means the
   sizer opens, focuses and clamps identically however it was asked for. */
export const CUSTOM_KEY = '0';

/* What a key means on your turn. `null` is a key this table does not answer. */
export type TurnKey =
  | { do: 'fold' }
  | { do: 'checkOrCall'; kind: ActionKind }
  | { do: 'custom' }
  | { do: 'preset'; at: number };

export function turnKeyAction(
  key: string,
  { legal, presets, typing }: { legal: LegalActions; presets: Preset[]; typing: boolean },
): TurnKey | null {
  const { canRaise, checkOrCall } = raiseShape(legal);
  const k = key.toLowerCase();
  /* The one shortcut that survives a focused field. */
  if (k === 'r') return canRaise ? { do: 'custom' } : null;
  if (typing) return null;
  if (k === CUSTOM_KEY) return canRaise ? { do: 'custom' } : null;
  if (k === 'f') return legal.actions.includes('f') ? { do: 'fold' } : null;
  if (k === 'c') return checkOrCall ? { do: 'checkOrCall', kind: checkOrCall } : null;
  const at = PRESET_KEYS.indexOf(k);
  return at >= 0 && presets[at] ? { do: 'preset', at } : null;
}
