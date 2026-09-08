import { BoardText } from '../../ui/board-text.tsx';
import { LessonPage } from './lesson.tsx';

/* Ten rankings, strongest first, each with a real five-card example rendered
   the way the app renders a board. */
const RANKINGS: { name: string; cards: string[]; note: string }[] = [
  { name: 'Royal flush', cards: ['As', 'Ks', 'Qs', 'Js', 'Ts'], note: 'The top straight, all one suit.' },
  { name: 'Straight flush', cards: ['9h', '8h', '7h', '6h', '5h'], note: 'Five in a row, all one suit.' },
  { name: 'Four of a kind', cards: ['Qs', 'Qh', 'Qd', 'Qc', '4s'], note: 'All four of one rank.' },
  { name: 'Full house', cards: ['Js', 'Jh', 'Jd', '8c', '8s'], note: 'Three of one rank, two of another.' },
  { name: 'Flush', cards: ['Ad', 'Jd', '8d', '5d', '2d'], note: 'Five of one suit, in no order.' },
  { name: 'Straight', cards: ['Ts', '9d', '8c', '7h', '6s'], note: 'Five in a row, mixed suits.' },
  { name: 'Three of a kind', cards: ['7s', '7h', '7d', 'Kc', '2d'], note: 'Three of one rank.' },
  { name: 'Two pair', cards: ['Ah', 'Ad', '9s', '9c', '4h'], note: 'Two ranks paired.' },
  { name: 'One pair', cards: ['Ks', 'Kd', 'Qh', '7c', '3s'], note: 'One rank paired.' },
  { name: 'High card', cards: ['Ac', 'Jd', '9h', '6s', '3c'], note: 'Nothing at all. The top card plays.' },
];

export function Hands() {
  return (
    <LessonPage slug="hands">
      <p>
        Every hand of poker ends the same way: the five cards you can make are compared with the five
        somebody else can make, and the higher combination takes the pot. There are ten kinds, and
        this is the whole list. Suits never outrank each other, so two flushes are compared by their
        cards, not by whether one is hearts.
      </p>

      <div className="card" style={{ padding: 0, marginBottom: '1em' }}>
        <div className="table-wrap">
          <table className="table rank-table" aria-label="Hand rankings, strongest first">
            <thead>
              <tr>
                <th style={{ width: 36 }} className="r">
                  #
                </th>
                <th>Hand</th>
                <th>Example</th>
              </tr>
            </thead>
            <tbody>
              {RANKINGS.map((r, i) => (
                <tr key={r.name}>
                  <td className="r">{i + 1}</td>
                  <td>
                    {r.name}
                    <div className="muted">{r.note}</div>
                  </td>
                  <td>
                    <BoardText cards={r.cards} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <h2>The kicker</h2>
      <p>
        Two players often make the same hand. When they do, the cards that are not part of the
        combination break the tie, one at a time, from the highest down. Those cards are kickers.
      </p>
      <p>
        Say the board is <BoardText cards={['Ks', '9d', '4c', '2h', '7s']} />. You hold an ace and a
        king, somebody else holds a king and a ten. You both have one pair of kings, so the pair
        settles nothing and the next card decides it: your ace beats their ten and you win the pot.
        This is why an ace with a weak second card is a trap. You will keep making the same pair as
        everybody else and losing the kicker.
      </p>
      <p>
        A hand is always exactly five cards. If the board itself is the best five available to both
        players, neither kicker plays and the pot is split.
      </p>
    </LessonPage>
  );
}
