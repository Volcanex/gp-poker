/* A compact read on the hand in front of you: what you hold, what would improve
   it, and how often it wins against that many random hands.

   Everything is computed in the analysis worker, so a slow answer never blocks
   a click. Each street cancels the previous street's requests rather than
   letting them land late and overwrite a newer number. The equity is against
   random hands, deliberately: it is a floor, not a read, and calling it a read
   would be a lie about what this can know. */

import { useEffect, useState } from 'react';
import { BoardText } from '../ui/board-text.tsx';
import { analyse, analyseName, analyseOuts, cancel, isCancelled, nextRequestId } from './index.ts';
import type { Card, HandNaming, Villain } from './index.ts';
import type { EquityResult, OutsResult } from '@opentable/equity';
import './live-stats.css';

export interface LiveStatsProps {
  hole: [Card, Card] | null;
  board: Card[];
  opponents: number;
}

const MAX_OUTS_SHOWN = 8;

export function villainsFor(opponents: number): Villain[] {
  const n = Math.max(1, Math.min(8, Math.round(opponents)));
  return Array.from({ length: n }, () => 'random' as const);
}

export function outsLabel(count: number): string {
  if (count === 0) return 'No outs';
  return `${count} ${count === 1 ? 'out' : 'outs'}`;
}

export function percentLabel(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

export function opponentsLabel(opponents: number): string {
  const n = villainsFor(opponents).length;
  return `vs ${n} random ${n === 1 ? 'hand' : 'hands'}`;
}

/* The street decides what can be said at all: no made hand before the flop, no
   outs once the river is down. */
export function readsFor(board: Card[]): { name: boolean; outs: boolean } {
  return { name: board.length >= 3, outs: board.length === 3 || board.length === 4 };
}

export function precisionLabel(result: EquityResult | null): string {
  if (!result) return '';
  return result.exact ? 'exact' : `sampled, ${result.samples.toLocaleString('en-GB')} deals`;
}

export function LiveStats({ hole, board, opponents }: LiveStatsProps) {
  const [naming, setNaming] = useState<HandNaming | null>(null);
  const [outs, setOuts] = useState<OutsResult | null>(null);
  const [equity, setEquity] = useState<EquityResult | null>(null);
  const [busy, setBusy] = useState(false);

  const key = `${hole?.join('') ?? ''}|${board.join('')}|${opponents}`;
  const reads = readsFor(board);

  useEffect(() => {
    if (!hole) {
      setNaming(null);
      setOuts(null);
      setEquity(null);
      return;
    }
    const ids = [nextRequestId('n'), nextRequestId('o'), nextRequestId('e')];
    const jobs: Promise<unknown>[] = [];
    let live = true;
    setBusy(true);

    if (reads.name) {
      jobs.push(analyseName({ id: ids[0], cards: [...hole, ...board] }).then(setNaming));
    } else {
      setNaming(null);
    }
    if (reads.outs) {
      jobs.push(analyseOuts({ id: ids[1], hero: hole, board }).then(setOuts));
    } else {
      setOuts(null);
    }
    jobs.push(analyse({ id: ids[2], hero: hole, board, villains: villainsFor(opponents) }).then(setEquity));

    Promise.all(jobs)
      .catch((err) => {
        if (!isCancelled(err)) console.error(err);
      })
      .finally(() => {
        if (live) setBusy(false);
      });

    return () => {
      live = false;
      for (const id of ids) cancel(id);
    };
    // The street is the whole input: recompute when any card or seat changes.
  }, [key]);

  const shown = outs?.cards.slice(0, MAX_OUTS_SHOWN) ?? [];
  const hidden = (outs?.cards.length ?? 0) - shown.length;

  return (
    <div className="card live-stats" role="group" aria-label="Hand analysis" aria-busy={busy}>
      <div className="ls-row">
        <span className="ls-label">Hand</span>
        <span className="ls-value">{naming?.name ?? (reads.name ? <Waiting /> : 'Preflop')}</span>
      </div>

      <div className="ls-row">
        <span className="ls-label">Outs</span>
        <span className="ls-value">
          {!reads.outs ? (
            <span className="ls-note">{board.length >= 5 ? 'No cards to come' : 'From the flop on'}</span>
          ) : outs ? (
            <>
              <span className="num">{outsLabel(outs.count)}</span>
              {shown.length > 0 && <BoardText cards={shown} />}
              {hidden > 0 && <span className="ls-note">and {hidden} more</span>}
              {outs.draws.length > 0 && <span className="ls-note">{outs.draws.join(', ')}</span>}
            </>
          ) : (
            <Waiting />
          )}
        </span>
      </div>

      <div className="ls-row">
        <span className="ls-label">Equity</span>
        <span className="ls-value">
          {equity ? <span className="num ls-equity">{percentLabel(equity.equity)}</span> : <Waiting />}
          <span className="ls-note">{opponentsLabel(opponents)}</span>
          {equity && <span className="ls-note">{precisionLabel(equity)}</span>}
        </span>
      </div>
    </div>
  );
}

function Waiting() {
  return <span className="ls-note ls-waiting">Computing</span>;
}
