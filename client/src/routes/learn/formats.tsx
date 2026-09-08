import {
  HAND_HOLD_MS,
  READY_CHECK_MS,
  SIX_MAX_LONG,
  SIX_MAX_SHORT,
  HEADS_UP_LONG,
  HEADS_UP_SHORT,
  READY_COOLDOWN_MS,
  ceilingFor,
  matchCeilingMs,
} from '@opentable/protocol';
import { Link } from 'react-router-dom';
import { LessonPage, Figure } from './lesson.tsx';
import { secs } from './constants.ts';

const hu = HEADS_UP_LONG;
const sm = SIX_MAX_LONG;
const smShort = SIX_MAX_SHORT;
const huShort = HEADS_UP_SHORT;

const mins = (ms: number) => Math.round(ms / 60_000);

export function Formats() {
  return (
    <LessonPage slug="formats">
      <p>
        There are two games here and two speeds to play either at. Nothing is ever left running: a
        match starts, it finishes, and your rating in that mode moves. Every match has a permanent
        public page afterwards with all of its hands.
      </p>

      <h2>Six handed, the main game</h2>
      <p>
        {sm.players} seats, {sm.stack} units each, last player with chips wins. There is no hand
        limit. Instead the blinds climb, which is what makes it end: as they grow past what a short
        stack can survive, folding stops being free. Places are recorded in the order players are
        knocked out, and every place counts towards your rating.
      </p>

      <h2>Heads-up</h2>
      <p>
        Two players, {hu.stack} units each. It is best of <strong>{hu.hands}</strong> hands: whoever
        has more chips after {hu.hands} hands wins, unless somebody busts first, and exactly equal
        stacks at the end is a draw. The button alternates, so you play the same number of hands from
        each seat.
      </p>

      <h2>Short and long</h2>
      <p>
        Every table is one or the other, picked on the same card you pick rated or casual on. They
        are separate queues and separate games, but <strong>not</strong> separate ratings: there is
        one rating per mode and the speed rides along with it.
      </p>
      <p>
        A <strong>long</strong> table is the game this site started with. Twenty seconds a decision,
        and the blinds move slowly enough that a six handed table normally runs on hands rather than
        on any clock. It cannot outlast{' '}
        <strong>{mins(ceilingFor('long'))} minutes</strong>, and a schedule keyed to elapsed time is
        what guarantees that: it sits far enough behind normal play never to be noticed, and takes
        over on a table that is running long.
      </p>
      <p>
        A <strong>short</strong> table is the fast game. {secs(smShort.clockMs)} seconds a decision,
        and the blinds climb every <strong>{smShort.levelSeconds} seconds</strong> from the moment the
        match is created, whatever is happening at the table. That is what holds it inside{' '}
        <strong>{mins(ceilingFor('short'))} minutes</strong>: by the last levels the big blind is
        larger than anybody's stack, so every hand is all-in and the table settles. At that speed you
        want the number keys, which bet a fraction of the pot without your hand leaving the keyboard.
      </p>

      <Figure
        caption={`The short six handed schedule, ${smShort.levelSeconds} seconds a level. The last level stays put, and by then a big blind is more than a starting stack.`}
      >
        <table className="table" aria-label="Short six-max blind schedule">
          <thead>
            <tr>
              <th className="r" style={{ width: 48 }}>Level</th>
              <th className="r">Small blind</th>
              <th className="r">Big blind</th>
              <th className="r">From</th>
            </tr>
          </thead>
          <tbody>
            {smShort.levels.map((l, i) => {
              const at = i * (smShort.levelSeconds ?? 0);
              return (
                <tr key={i}>
                  <td className="r">{i + 1}</td>
                  <td className="r">{l.sb}</td>
                  <td className="r">{l.bb}</td>
                  <td className="r">
                    {Math.floor(at / 60)}:{String(at % 60).padStart(2, '0')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Figure>

      <Figure caption={`The long six handed schedule, ${sm.levelHands} hands per level. The last level stays put.`}>
        <table className="table" aria-label="Long six-max blind schedule">
          <thead>
            <tr>
              <th className="r" style={{ width: 48 }}>Level</th>
              <th className="r">Small blind</th>
              <th className="r">Big blind</th>
              <th className="r">From hand</th>
            </tr>
          </thead>
          <tbody>
            {sm.levels.map((l, i) => (
              <tr key={i}>
                <td className="r">{i + 1}</td>
                <td className="r">{l.sb}</td>
                <td className="r">{l.bb}</td>
                <td className="r">{i * sm.levelHands + 1}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Figure>

      <p>
        Short heads-up keeps the {huShort.hands} hand cap and adds the same kind of ladder behind it,
        so it ends on hands, on a bust, or on the clock, whichever arrives first. The worst case is{' '}
        {mins(matchCeilingMs(huShort))} minutes.
      </p>

      <h2>The clock</h2>
      <p>
        You get <strong>{secs(hu.clockMs)} seconds</strong> for every decision at a long table and{' '}
        <strong>{secs(huShort.clockMs)} seconds</strong> at a short one. If your connection drops, the
        clock pauses for a grace period while you reconnect, {secs(hu.graceMs)} seconds long or{' '}
        {secs(huShort.graceMs)}, and then it runs again whether you are there or not.
      </p>
      <p>
        Running out of time checks if checking is free and folds if it is not. Three of those in a row
        means you have gone: heads-up that forfeits the match, because the other player has nobody
        else to play. Six handed it sits you out instead, folding your hands and posting your blinds
        until you either act again or run out of chips, so one person walking away does not end the
        table for the other four.
      </p>
      <p>
        Between hands there is a {secs(HAND_HOLD_MS)} second pause on the finished hand, so you can
        see what happened before the next one is dealt.
      </p>

      <h2>The ready check</h2>
      <p>
        When the queue finds you a table, everybody at it is asked to accept before a card is dealt.
        You get <strong>{secs(READY_CHECK_MS)} seconds</strong>. If everybody accepts, the table
        deals. If anybody declines or says nothing, nobody plays: the people who did accept go back to
        the front of the queue and keep searching, and whoever did not answer waits{' '}
        {mins(READY_COOLDOWN_MS)} minutes before they can search again, doubling for every further
        one inside the hour.
      </p>
      <p>
        A link you were sent has no ready check, because it is not a stranger and you opened it on
        purpose: a challenge starts when you accept it and a home game starts when its host says so.
        Practice has none either.
      </p>

      <h2>Rated, casual and practice</h2>
      <p>
        Every match is rated or casual, chosen on the card you start it from. Rated moves your rating
        for that mode. Casual moves nothing and is otherwise identical.
      </p>
      <p>
        <strong>Rated opens after one casual or practice match.</strong> One, and it can be any of
        them: it is there so that nobody's first ever hand moves a rating they had not noticed they
        had. Nothing else is locked, ever. Your level is how many matches you have finished and it
        unlocks nothing at all.
      </p>
      <p>
        <strong>Practice against bots</strong> is never rated. It seats you against bots immediately
        with no queue, and it turns on the things that would be unfair at a real table: your equity
        and your outs, live, while the hand is going on. It is the place to try what you have read
        here.
      </p>
      <p>
        Bots fill a seat in casual play too, not just in practice. A heads-up table brings one in
        after a few seconds of nobody else queuing, and a casual six handed table waits rather longer
        before filling the empty seats, since gathering real players is worth a little patience. A
        <strong> rated six handed table is people only</strong> and will wait for them. A bot never
        sits at a table with no people at it, and bot matches carry a bot tag on every feed and every
        result, so you always know what you played.
      </p>
      <p>
        Start any of it from the <Link to="/">home page</Link>.
      </p>
    </LessonPage>
  );
}
