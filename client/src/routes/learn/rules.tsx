import { HEADS_UP_FORMAT } from '@opentable/protocol';
import { BoardText } from '../../ui/board-text.tsx';
import { LessonPage, Figure } from './lesson.tsx';
import { LatestHandLink } from './latest-hand.tsx';

const f = HEADS_UP_FORMAT;

export function Rules() {
  return (
    <LessonPage slug="rules">
      <p>
        Hold'em gives you two cards nobody else sees and five that everybody shares. Your hand is the
        best five cards you can make from those seven. You never have to build it yourself: at the end
        of a hand the table simply pays whoever has the best five, and most hands never get that far
        because everybody else has folded first.
      </p>

      <h2>The deal</h2>
      <p>
        Two cards go to each player, face down. One seat holds the button, which marks the last seat to act
        once the flop is down, and it moves one seat along after every hand so nobody keeps that
        advantage. Before any
        cards are looked at, two forced bets called blinds go in: the small blind of {f.sb} and the big
        blind of {f.bb}. The blinds are what make the game move. Without money already in the middle,
        folding everything would cost nothing.
      </p>

      <Figure caption="Two cards to you, five in the middle. Your hand is the best five of the seven.">
        <div className="stack" style={{ gap: 'var(--sp-3)' }}>
          <div>
            <span className="muted">Your cards</span> <BoardText cards={['Ah', 'Kd']} />
          </div>
          <div>
            <span className="muted">The board</span> <BoardText cards={['As', '9c', '4d', 'Kh', '2s']} />
          </div>
          <span className="muted">Two pair, aces and kings.</span>
        </div>
      </Figure>

      <h2>The four streets</h2>
      <p>
        A hand is four rounds of betting, each with more information than the last.
      </p>
      <ul>
        <li>
          <strong>Preflop</strong>. You have your two cards and nothing else. The blinds are already in.
        </li>
        <li>
          <strong>The flop</strong>. Three shared cards arrive at once. Most of your hand is decided here.
        </li>
        <li>
          <strong>The turn</strong>. A fourth shared card. Bets tend to get bigger.
        </li>
        <li>
          <strong>The river</strong>. The fifth and last shared card. Nothing is left to come, so a bet
          here is a claim you can be made to prove.
        </li>
      </ul>

      <h2>What you can do</h2>
      <ul>
        <li>
          <strong>Fold</strong>. Give up the hand. You lose whatever you already put in and nothing more.
        </li>
        <li>
          <strong>Check</strong>. Stay in without betting. Only legal when nobody has bet ahead of you.
        </li>
        <li>
          <strong>Call</strong>. Match the bet in front of you.
        </li>
        <li>
          <strong>Bet</strong>. Put chips in when nobody else has.
        </li>
        <li>
          <strong>Raise</strong>. Put in more than the bet in front of you, so everybody else has to pay
          the difference or fold.
        </li>
        <li>
          <strong>All-in</strong>. Bet everything you have left. No limit means you can do this at any
          point, on any street.
        </li>
      </ul>
      <p>
        A round of betting ends when everybody still in has either matched the largest bet or folded.
        If everyone folds to one player, the hand is over and no cards are shown.
      </p>

      <h2>Showdown</h2>
      <p>
        If two or more players are still in after the river, the cards come face up and the best five
        wins the pot. Two players with the same five split it evenly. When somebody is all-in for less
        than the others can bet, the extra chips go into a side pot that the all-in player cannot win:
        the main pot is settled between everybody, the side pot only between those who kept betting,
        which is why a big multiway hand can end with two different winners.
      </p>

      <p>
        <LatestHandLink label="Watch a real hand" />, dealt on this site, with every action and the
        deck it came from.
      </p>
    </LessonPage>
  );
}
