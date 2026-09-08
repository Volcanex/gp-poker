import { BoardText } from '../../ui/board-text.tsx';
import { LessonPage, Figure } from './lesson.tsx';

/* Percentages are the exact ones: with the flop down, 47 cards are unseen, so
   one card is outs/47 and two cards is 1 - (47-outs)/47 * (46-outs)/46. */
const DRAWS: { name: string; outs: number }[] = [
  { name: 'Flush draw and a gutshot', outs: 12 },
  { name: 'Flush draw', outs: 9 },
  { name: 'Open-ended straight draw', outs: 8 },
  { name: 'Two overcards', outs: 6 },
  { name: 'Gutshot straight draw', outs: 4 },
  { name: 'Two pair to a full house', outs: 4 },
  { name: 'One pair to trips', outs: 2 },
];

function oneCard(outs: number): number {
  return (outs / 47) * 100;
}

function twoCards(outs: number): number {
  return (1 - ((47 - outs) / 47) * ((46 - outs) / 46)) * 100;
}

const pct = (n: number) => `${Math.round(n)}%`;

export function Odds() {
  return (
    <LessonPage slug="odds">
      <p>
        Most decisions in poker are one question: is the price I am being asked to pay smaller than my
        chance of winning? Everything else is detail. Two numbers answer it, and both can be worked
        out at the table in a couple of seconds.
      </p>

      <h2>Counting outs</h2>
      <p>
        An out is a card still in the deck that gives you the best hand. You hold{' '}
        <BoardText cards={['Ah', 'Kh']} /> and the flop comes <BoardText cards={['9h', '4h', '2s']} />.
        Any heart makes your flush. There are thirteen hearts, you can see four of them, so nine are
        left: nine outs.
      </p>
      <p>
        Count only the cards that actually win. A card that gives you a flush and somebody else a full
        house is not an out, and half of your outs are worth less than you think when the board is
        paired. It is better to undercount than to talk yourself into a number.
      </p>

      <h2>The rule of two and four</h2>
      <p>
        With one card still to come, multiply your outs by <strong>two</strong> to get your chance as a
        percentage. With two cards still to come, multiply by <strong>four</strong>. Nine outs is
        roughly 18% on the river alone and roughly 36% from the flop to the end. The true figures are{' '}
        {pct(oneCard(9))} and {pct(twoCards(9))}, so the shortcut is close enough to bet on.
      </p>
      <p>
        One warning about the four. It assumes you get to see both cards, and you only do if nobody
        bets you off the hand on the turn. When there is still betting to come, the honest number is
        the two.
      </p>

      <h2>The price</h2>
      <p>
        Pot odds are what the pot is offering you. There are 60 units in the middle, your opponent bets
        30, so if you call you are putting in 30 to win 90. That is 30 out of the 120 the pot will
        contain, which means you need to win{' '}
        <strong>{pct((30 / 120) * 100)}</strong> of the time for the call to break even.
      </p>
      <p>
        Now put the two together. Your flush draw is about {pct(twoCards(9))} to get there by the
        river and about {pct(oneCard(9))} on the next card alone. Both are more than the{' '}
        {pct((30 / 120) * 100)} you need, so calling is correct even before counting the extra money
        you win on the hands where you hit. Turn the bet up to 60 into that same 60 pot and the price
        becomes 60 out of 180, or {pct((60 / 180) * 100)}, and the same draw is now a fold on the turn
        and a marginal call on the flop. The hand did not change. The price did.
      </p>

      <Figure caption="From the flop, with 47 cards unseen. The rule of two and four is the same table, rounded.">
        <table className="table" aria-label="Common draws and their odds">
          <thead>
            <tr>
              <th>Draw</th>
              <th className="r">Outs</th>
              <th className="r">Next card</th>
              <th className="r">By the river</th>
            </tr>
          </thead>
          <tbody>
            {DRAWS.map((d) => (
              <tr key={d.name}>
                <td>{d.name}</td>
                <td className="r">{d.outs}</td>
                <td className="r">{pct(oneCard(d.outs))}</td>
                <td className="r">{pct(twoCards(d.outs))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Figure>

      <p>
        None of this needs to be exact. You are deciding whether a number is bigger or smaller than
        another number, and both of them are approximations. Getting into the habit of asking the
        question at all is most of the gain.
      </p>
    </LessonPage>
  );
}
