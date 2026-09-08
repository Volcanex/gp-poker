/* The pieces all three puzzle pages share: the record under the puzzle, the
   verdict badge, and the one keyboard contract. Every page answers with the
   number keys and moves on with Enter, so the shortcut lives here rather than
   being written out three times and drifting. */

import { useEffect } from 'react';
import { isTextEntry } from '../ui/bits.tsx';
import { accuracyOf, type Tally } from './store.ts';

export function ScoreRow({ tally }: { tally: Tally }) {
  return (
    <section className="card puzzle-score" aria-label="Your record">
      <div>
        <span className="label">Streak</span>
        <span className="num">{tally.streak}</span>
      </div>
      <div>
        <span className="label">Best streak</span>
        <span className="num">{tally.best}</span>
      </div>
      <div>
        <span className="label">Accuracy</span>
        <span className="num">{tally.total ? `${accuracyOf(tally).toFixed(0)}%` : '…'}</span>
      </div>
      <div>
        <span className="label">Solved</span>
        <span className="num">{tally.total}</span>
      </div>
    </section>
  );
}

export function Verdict({ right, text }: { right: boolean; text: string }) {
  return <span className={`badge verdict ${right ? 'badge-ok' : 'badge-warn'}`}>{text}</span>;
}

/* Number keys pick an answer, Enter takes the next puzzle. The keys are live
   only while there is something to answer, so pressing 2 after answering does
   not silently rewrite what you said. */
export function useAnswerKeys(options: {
  choices: number;
  answered: boolean;
  onChoose: (index: number) => void;
  onNext: () => void;
}): void {
  const { choices, answered, onChoose, onNext } = options;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTextEntry(event.target)) return;
      if (answered) {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        onNext();
        return;
      }
      const index = Number(event.key) - 1;
      if (!Number.isInteger(index) || index < 0 || index >= choices) return;
      event.preventDefault();
      onChoose(index);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [answered, choices, onChoose, onNext]);
}

/* The hint under a set of answer buttons, so the shortcut is discoverable
   rather than a thing you have to be told. */
export function KeyHint({ answered, choices }: { answered: boolean; choices: number }) {
  if (answered) return <span className="muted small">Press enter for the next one.</span>;
  return <span className="muted small">Or press {choices === 2 ? '1 or 2' : `1 to ${choices}`}.</span>;
}
