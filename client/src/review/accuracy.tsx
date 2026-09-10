import { Info } from '@phosphor-icons/react/dist/icons/Info';
import { fmtPct } from '../ui/format.ts';
import type { MatchAccuracy } from '../net/types.ts';

const ACCURACY_NOTE =
  'How close each preflop decision was to the baseline charts, from 0 to 100. Preflop only, and it says nothing about the flop, the turn or the river. The most accurate player at a table does not always win the hand, or the match.';

/* The "little i": one sentence the owner asked to ship verbatim in spirit,
   because a number this easy to misread needs the caveat sitting on it
   rather than in a page nobody scrolls to. `data-tip` is g-ui's own
   tooltip wiring (g-ui.js listens for it globally; nothing here has to call
   g.init), which is also why the trigger is a plain button and not a new
   popover component. */
export function AccuracyTile({ accuracy, studied }: { accuracy: MatchAccuracy | null; studied: boolean }) {
  return (
    <div className="card stat">
      <span className="k acc-k">
        Preflop accuracy
        <button type="button" className="i-btn" data-tip={ACCURACY_NOTE} aria-label="What accuracy means">
          <Info size={13} weight="bold" />
        </button>
      </span>
      {!studied ? (
        <span className="v" data-empty="">Not tracked in six-max</span>
      ) : accuracy === null || accuracy.hands === 0 ? (
        <span className="v" data-empty="">No graded hands</span>
      ) : (
        <span className="v">{fmtPct(accuracy.mean ?? 0, 0)}</span>
      )}
      <span className="d">
        {!studied
          ? 'Six-max stores no preflop study; this reads only on heads-up matches.'
          : accuracy && accuracy.hands > 0
            ? `Averaged over ${accuracy.hands} graded ${accuracy.hands === 1 ? 'hand' : 'hands'}.`
            : 'Nobody at this table faced a hand the charts score.'}
      </span>
    </div>
  );
}
