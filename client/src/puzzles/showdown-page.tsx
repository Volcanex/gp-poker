/* Who wins. A finished board, two to four hands, and one question.

   The page never decides the hand. It deals, sends the deal to the analysis
   worker while the player is reading it, and grades the answer against what
   the evaluator says, which is the evaluator the engine settles pots with. The
   names come back with the verdict, so every hand is read out whether or not
   it won: that is the part that teaches. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { analyseShowdown, cancel, isCancelled, nextRequestId, type ShowdownRead } from '../analysis/index.ts';
import { BoardText } from '../ui/board-text.tsx';
import { useTitle } from '../ui/title.ts';
import { KeyHint, ScoreRow, useAnswerKeys, Verdict } from './bits.tsx';
import { dealShowdown, shapeFor, type ShowdownPuzzle } from './showdown.ts';
import { afterAnswer, emptyPuzzles, readPuzzles, writePuzzles, type Puzzles } from './store.ts';

const SPLIT = 'split';

export function Showdown() {
  const [puzzles, setPuzzles] = useState<Puzzles>(() => emptyPuzzles());
  const [puzzle, setPuzzle] = useState<ShowdownPuzzle>(() => dealShowdown(shapeFor(0)));
  const [read, setRead] = useState<ShowdownRead | null>(null);
  const [answer, setAnswer] = useState<number | typeof SPLIT | null>(null);
  const answered = useRef(false);
  useTitle('Who wins');

  useEffect(() => setPuzzles(readPuzzles()), []);

  useEffect(() => {
    const id = nextRequestId('s');
    let live = true;
    setRead(null);
    analyseShowdown({ id, board: puzzle.board, hands: puzzle.hands })
      .then((r) => {
        if (live) setRead(r);
      })
      .catch((err) => {
        if (!live || isCancelled(err)) return;
        console.error(err);
      });
    return () => {
      live = false;
      cancel(id);
    };
  }, [puzzle]);

  const tally = puzzles.types.showdown;

  const next = useCallback(() => {
    answered.current = false;
    setAnswer(null);
    setPuzzle(dealShowdown(shapeFor(tally.streak)));
  }, [tally.streak]);

  const answerWith = useCallback(
    (choice: number | typeof SPLIT) => {
      if (answered.current || !read) return;
      answered.current = true;
      setAnswer(choice);
      const split = read.winners.length > 1;
      const right = choice === SPLIT ? split : !split && read.winners[0] === choice;
      setPuzzles((prev) => {
        const updated = afterAnswer(prev, 'showdown', right);
        writePuzzles(updated);
        return updated;
      });
    },
    [read],
  );

  const choices = puzzle.hands.length + 1;
  const onChoose = useCallback(
    (index: number) => answerWith(index === puzzle.hands.length ? SPLIT : index),
    [answerWith, puzzle.hands.length],
  );
  useAnswerKeys({ choices, answered: answer !== null, onChoose, onNext: next });

  const split = read ? read.winners.length > 1 : false;
  const right = answer === null ? false : answer === SPLIT ? split : !split && read?.winners[0] === answer;
  const winnerWord = !read
    ? ''
    : split
      ? `Hands ${read.winners.map((w) => w + 1).join(' and ')} split the pot.`
      : `Hand ${read.winners[0] + 1} wins.`;

  return (
    <main className="page stack puzzles-page">
      <div className="stack" style={{ gap: 'var(--sp-3)' }}>
        <h1 className="h1">Who wins</h1>
        <p className="muted">
          Every card is out. Read each hand, pick the one that takes it, and say split when two hands
          are the same. The verdict comes from the evaluator that settles pots at the table, so it is
          the real answer rather than an opinion. The rankings are in{' '}
          <Link to="/learn/hands">the hand rankings lesson</Link>.
        </p>
      </div>

      <section className="card stack" aria-label="The showdown">
        <div className="puzzle-board">
          <div className="field">
            <span className="label">The board</span>
            <BoardText cards={puzzle.board} />
          </div>
        </div>

        <dl className="puzzle-hands">
          {puzzle.hands.map((hole, i) => {
            const won = answer !== null && read?.winners.includes(i);
            return (
              <div className="puzzle-hand" key={hole.join('')} {...(won ? { 'data-winner': '' } : {})}>
                <dt className="who">Hand {i + 1}</dt>
                <dd style={{ margin: 0 }}>
                  <BoardText cards={hole} />
                </dd>
                {answer !== null && read && <dd className="said">{read.hands[i].name}</dd>}
              </div>
            );
          })}
        </dl>

        {answer === null ? (
          <div className="row">
            {puzzle.hands.map((hole, i) => (
              <button
                key={hole.join('')}
                type="button"
                className="btn btn-secondary"
                disabled={!read}
                onClick={() => answerWith(i)}
              >
                Hand {i + 1}
              </button>
            ))}
            <button type="button" className="btn btn-secondary" disabled={!read} onClick={() => answerWith(SPLIT)}>
              Split
            </button>
            {read ? (
              <KeyHint answered={false} choices={choices} />
            ) : (
              <span className="muted small">Reading the board.</span>
            )}
          </div>
        ) : (
          <div className="stack">
            <Verdict right={right} text={right ? 'Right' : 'Not this one'} />
            <p className="puzzle-line">{winnerWord}</p>
            <div className="row">
              <button type="button" className="btn btn-primary" onClick={next}>
                Deal the next board
              </button>
              <KeyHint answered choices={choices} />
            </div>
          </div>
        )}
      </section>

      <ScoreRow tally={tally} />

      <p className="muted">
        The boards get harder as the streak grows: more hands, then hands that share a pair so only
        the kicker is left, then boards that play themselves. <Link to="/puzzles">Back to puzzles</Link>.
      </p>
    </main>
  );
}
