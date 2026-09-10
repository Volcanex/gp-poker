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
import type { EquityResult } from '@opentable/equity';
import type { OutsRead } from './draw-outs.ts';
import type { DrawName, HandCategory } from '@opentable/equity';
import { STUDS, drawTargets, preflopWords, studOf } from './strength.ts';
import './live-stats.css';

export interface LiveStatsProps {
  hole: [Card, Card] | null;
  board: Card[];
  opponents: number;
}

/* Nine is a flush draw, the longest list worth printing in full. */
const MAX_OUTS_SHOWN = 9;

export function villainsFor(opponents: number): Villain[] {
  const n = Math.max(1, Math.min(8, Math.round(opponents)));
  return Array.from({ length: n }, () => 'random' as const);
}

export interface OutsLine {
  label: string;
  cards: Card[];
  draws: string;
  /* The category count is a secondary reading, not the headline number. */
  muted: boolean;
}

/* What the outs row says. A named draw is the number a player counts, so a
   flush draw reads "9 outs" and an open-ender "8 outs", never the twenty six
   cards that happen to improve the category. With no draw there is no outs
   number to give, only how many cards improve the hand at all, which is worth
   knowing and is not worth the headline. See draw-outs.ts for why the two
   numbers differ. */
export function outsLine(result: OutsRead | null): OutsLine | null {
  if (!result) return null;
  /* A backdoor draw names itself but completes on no single card, so it has
     no outs number to headline; it falls through to the muted reading. */
  if (result.draws.length > 0 && result.drawCards.length > 0) {
    const n = result.drawCards.length;
    return {
      label: `${n} ${n === 1 ? 'out' : 'outs'}`,
      cards: result.drawCards,
      draws: result.draws.join(', '),
      muted: false,
    };
  }
  /* No named draw, so there is no outs number to headline: the category
     count alone read as an outs figure a player did not recognise ("Improves
     on 14 cards" beside a hand with no draw). Saying there is no draw first
     is what the number was missing. */
  const n = result.count;
  return {
    label: n === 0 ? 'No draw, and nothing helps' : `No draw, but ${n} ${n === 1 ? 'card helps' : 'cards help'}`,
    cards: [],
    draws: result.draws.join(', '),
    muted: true,
  };
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

/* The draws' names at the strip's width: the package's names are the full
   ones and the replay panel prints them, but a cell nine rem wide has room
   for "flush draw, open-ender" and not for the open-ended straight draw. */
const SHORT: Partial<Record<DrawName, string>> = {
  'open-ended straight draw': 'open-ender',
  'backdoor flush draw': 'backdoor flush',
};

/* Sentence case, like every other label on the site: the package's names are
   written lowercase because they are names of things, and this is the one
   place they are a line of their own rather than a phrase inside one. */
export function drawWords(draws: readonly DrawName[]): string {
  const line = draws.map((d) => SHORT[d] ?? d).join(', ');
  return line ? line[0].toUpperCase() + line.slice(1) : line;
}

/* What the strength meter says to a screen reader, the studs being pictures.
   "High card, drawing to a straight and a flush". */
export function studsLabel(category: HandCategory | null, targets: number[]): string {
  const made = category ? category[0].toUpperCase() + category.slice(1) : 'No made hand yet';
  if (targets.length === 0) return made;
  const to = targets.map((i) => STUDS[i]);
  const list = to.length === 1 ? to[0] : `${to.slice(0, -1).join(', ')} and ${to[to.length - 1]}`;
  return `${made}, drawing to ${list}`;
}

export function LiveStats({ hole, board, opponents }: LiveStatsProps) {
  const [naming, setNaming] = useState<HandNaming | null>(null);
  const [outs, setOuts] = useState<OutsRead | null>(null);
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

  const line = outsLine(outs);
  const shown = line?.cards.slice(0, MAX_OUTS_SHOWN) ?? [];
  const hidden = (line?.cards.length ?? 0) - shown.length;

  /* Before the flop there is no made hand to light a stud for, so the row
     stays dark and the holding is named in words instead. */
  const category = reads.name ? naming?.category ?? null : null;
  const handName = !reads.name
    ? hole ? preflopWords(hole) : ''
    : naming?.name ?? '';
  const targets = line && !line.muted ? drawTargets(outs?.draws ?? [], category) : [];
  const pct = equity ? percentLabel(equity.equity) : '';

  return (
    <div className="card live-stats" role="group" aria-label="Hand analysis" aria-busy={busy}>
      <StrengthMeter category={category} targets={targets} name={handName} waiting={reads.name && !naming} />

      <div className="ls-cell ls-outs">
        <div className="ls-line">
          {/* Every branch is keyed so React never hands one branch's node to
              the next: the observer counts a reused node that lands somewhere
              else as a shift, and a fresh node as content arriving. */}
          {!reads.outs ? (
            <span key="none" className="ls-v ls-v-wide ls-note">{board.length >= 5 ? 'No cards to come' : 'From the flop on'}</span>
          ) : line ? (
            <>
              <span key={line.label} className={`ls-v ${line.muted ? 'ls-note' : 'num'}`}>{line.label}</span>
              <span key="cards" className="ls-cards">
                {shown.length > 0 && <BoardText cards={shown} />}
                {hidden > 0 && <span className="ls-note ls-more">and {hidden} more</span>}
              </span>
            </>
          ) : (
            <Waiting key="wait" />
          )}
        </div>
        <div className="ls-sub">
          <span key={line?.draws ?? ''} className="ls-note">{drawWords(outs?.draws ?? [])}</span>
        </div>
      </div>

      <div className="ls-cell ls-eq">
        <div className="ls-line">
          {equity ? <span key={pct} className="ls-v num">{pct}</span> : <Waiting key="wait" />}
          <span
            className="g-meter ls-meter"
            role="meter"
            aria-label="Equity"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={equity ? Math.round(equity.equity * 100) : undefined}
          >
            <span className="g-meter-fill" style={{ width: equity ? `${equity.equity * 100}%` : 0 }} />
          </span>
        </div>
        <div className="ls-sub">
          <span className="ls-note">{opponentsLabel(opponents)}</span>
          {equity && <span className="ls-note ls-extra">{precisionLabel(equity)}</span>}
        </div>
      </div>
    </div>
  );
}

interface StrengthMeterProps {
  category: HandCategory | null;
  targets: number[];
  name: string;
  waiting: boolean;
}

/* Nine studs, one per hand category, weakest on the left. Everything up to
   the hand you hold is lit, the studs a live draw would land on are hollow,
   and the rest are dark. Only the stud that has just lit is drawn in: it is
   keyed on its category, so a better hand mounts a new top stud and the
   masked reveal runs once on it, while the studs under it, already lit or
   lit in the same step, snap. A hand that gets worse (the next deal) snaps
   dark: nothing on this screen animates a loss of information. */
function StrengthMeter({ category, targets, name, waiting }: StrengthMeterProps) {
  const top = category ? studOf(category) : -1;
  return (
    <div className="ls-cell ls-str">
      <div className="ls-line ls-studs" role="img" aria-label={studsLabel(category, targets)}>
        {STUDS.map((cat, i) => (
          <span
            key={i === top ? `top-${cat}` : i}
            className="stud"
            data-lit={i <= top ? '' : undefined}
            data-new={i === top ? '' : undefined}
            data-aim={targets.includes(i) ? '' : undefined}
            title={cat[0].toUpperCase() + cat.slice(1)}
          />
        ))}
      </div>
      <div className="ls-sub">
        {waiting ? <Waiting key="wait" /> : <span key={name} className="ls-name">{name}</span>}
      </div>
    </div>
  );
}

function Waiting() {
  return <span className="ls-v ls-note ls-waiting">Computing</span>;
}
