import { LessonPage, Figure } from './lesson.tsx';
import { chartFor, countRegions, gridFor } from './chart-data.ts';

const BUCKET = 'deep';
const SPOT = 'sb_open';

export function Ranges() {
  const entry = chartFor(BUCKET, SPOT);
  const grid = gridFor(entry);
  const counts = countRegions(grid);
  const total = counts.aggr + counts.passive + counts.fold;

  return (
    <LessonPage slug="ranges">
      <p>
        You will never know what somebody has. You can know what they could have, and that set of
        hands is called a range. Thinking in ranges instead of single hands is the step that turns
        guessing into reasoning: you stop asking whether they have the flush and start asking how
        often the way they played it contains one.
      </p>

      <h2>The grid</h2>
      <p>
        Suits do not matter before the flop, only whether your two cards share one. That collapses
        1326 possible starting hands into <strong>{total}</strong> kinds, and everybody draws them on
        the same 13 by 13 grid. Pairs run down the diagonal from aces at the top left. Above the
        diagonal are the suited hands, below it the offsuit ones, ranks descending both ways. A range
        is a shape on that grid, which is why two players can compare ranges without writing out a
        list.
      </p>

      <h2>The chart this site uses</h2>
      <p>
        Below is the real baseline chart Open Table scores your preflop decisions against: the small
        blind opening heads-up with a deep stack, which is the very first decision of most hands you
        will play here. Green is raise, amber is limp, and the rest is fold.
      </p>

      <Figure
        caption={`Heads-up small blind opening range, deep stacks. Raise ${counts.aggr} of the ${total} hand classes, limp ${counts.passive}, fold ${counts.fold}.`}
      >
        <div className="range-grid-wrap">
          <div className="range-grid" role="img" aria-label="Preflop opening range grid, 13 by 13">
            {grid.flat().map((cell) => (
              <div className="range-cell" key={cell.hand} data-region={cell.region} title={cell.hand}>
                {cell.hand}
              </div>
            ))}
          </div>
        </div>
      </Figure>

      <div className="legend">
        <span className="key">
          <span className="sw" data-region="aggr" /> Raise <span className="num">{counts.aggr}</span>
        </span>
        <span className="key">
          <span className="sw" data-region="passive" /> Limp <span className="num">{counts.passive}</span>
        </span>
        <span className="key">
          <span className="sw" /> Fold <span className="num">{counts.fold}</span>
        </span>
      </div>

      <p>
        That range is enormous, and it should be. Heads-up there is only one other player to get
        through, and you have already posted the small blind, so folding every hand you are only
        slightly behind with gives the pot away for nothing. The further from the button you sit at a six handed
        table, the tighter the same kind of chart becomes, because there are more players left to
        act behind you.
      </p>

      <h2>Where these numbers come from</h2>
      <p>
        Be clear about what you are looking at. These are <strong>heuristic baselines</strong>, built
        by hand from an equity ranking of all {total} starting hands and the standard shapes of
        heads-up strategy: wide button opens, ranges that narrow as raises stack up, and push-or-fold
        approximations once stacks are short. They are <strong>not solver output</strong>, and nothing
        here is game theory optimal.
      </p>
      <p>
        They exist to give you an explainable signal after a hand, along the lines of "that was a
        clear fold", not a target to memorise. Your accuracy score on a match is measured against
        this chart, so treat it as a rough second opinion rather than a verdict.
      </p>
    </LessonPage>
  );
}
