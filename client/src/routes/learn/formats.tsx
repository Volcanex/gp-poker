import { HAND_HOLD_MS, HEADS_UP_FORMAT, SIX_MAX_FORMAT } from '@opentable/protocol';
import { Link } from 'react-router-dom';
import { LessonPage, Figure } from './lesson.tsx';
import { secs } from './constants.ts';

const hu = HEADS_UP_FORMAT;
const sm = SIX_MAX_FORMAT;

export function Formats() {
  return (
    <LessonPage slug="formats">
      <p>
        There are two ways to play here and both are short. Nothing is ever left running: a match
        starts, it finishes, and your rating in that format moves. Every match has a permanent public
        page afterwards with all of its hands.
      </p>

      <h2>Heads-up</h2>
      <p>
        Two players, {hu.stack} units each, blinds fixed at {hu.sb} and {hu.bb} the whole way. It is{' '}
        best of <strong>{hu.hands}</strong> hands: whoever has more chips after {hu.hands} hands wins,
        unless somebody busts first, and exactly equal stacks at the end is a draw. The button
        alternates, so you play the same number of hands from each seat.
      </p>
      <p>
        Blinds do not climb because they do not need to. {hu.hands} hands is short enough to end on
        its own.
      </p>

      <h2>Six-max sit-and-go</h2>
      <p>
        {sm.players} seats, {sm.stack} units each, last player with chips wins. There is no hand
        limit. Instead the blinds climb every <strong>{sm.levelHands}</strong> hands, which is what
        makes it end: as the blinds grow past what a short stack can survive, folding stops being
        free. Places are recorded in the order players are knocked out, and every place counts towards
        your rating.
      </p>

      <Figure caption={`The blind schedule, ${sm.levelHands} hands per level. The last level stays put.`}>
        <table className="table" aria-label="Six-max blind schedule">
          <thead>
            <tr>
              <th className="r" style={{ width: 48 }}>
                Level
              </th>
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

      <h2>The clock</h2>
      <p>
        You get <strong>{secs(hu.clockMs)} seconds</strong> for every decision. If your connection
        drops, the clock pauses for a {secs(hu.graceMs)} second grace period while you reconnect, and
        then it runs again whether you are there or not.
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

      <h2>Rated, casual and practice</h2>
      <p>
        Every match is rated or casual, chosen on the card you start it from. Rated moves your rating
        for that format. Casual moves nothing and is otherwise identical.
      </p>
      <p>
        <strong>Practice against bots</strong> is the third option on the home page and it is never
        rated. It seats you against bots immediately with no queue, and it turns on the things that
        would be unfair at a real table: your equity and your outs, live, while the hand is going on.
        It is the place to try what you have read here. Nothing you do in it can touch your rating.
      </p>
      <p>
        Bots fill a seat anywhere, not just in practice. A heads-up table brings one in after a few
        seconds of nobody else queuing, and a six-max table waits rather longer before filling the
        empty seats, since gathering real players is worth a little patience. A bot never sits at a
        table with no people at it. Bot matches are shown with
        a bot tag on every feed and every result, so you always know what you played.
      </p>
      <p>
        Start either format from the <Link to="/">home page</Link>.
      </p>
    </LessonPage>
  );
}
