import { SIX_MAX_FORMAT } from '@opentable/protocol';
import { LessonPage, Figure } from './lesson.tsx';

interface Seat {
  name: string;
  note: string;
  button?: boolean;
}

const HEADS_UP: Seat[] = [
  { name: 'Button', note: 'Posts the small blind, acts first before the flop and last after it.', button: true },
  { name: 'Big blind', note: 'Posts the big blind, acts last before the flop and first after it.' },
];

const SIX_MAX: Seat[] = [
  { name: 'Under the gun', note: 'First to act before the flop, with five players still to speak.' },
  { name: 'Hijack', note: 'Second in.' },
  { name: 'Cutoff', note: 'One seat before the button.' },
  { name: 'Button', note: 'Last to act after the flop, every hand.', button: true },
  { name: 'Small blind', note: 'Posts the small blind. First to act after the flop.' },
  { name: 'Big blind', note: 'Posts the big blind. Last to act before the flop.' },
];

function Seats({ seats, label }: { seats: Seat[]; label: string }) {
  return (
    <div className="seats-row" role="list" aria-label={label}>
      {seats.map((s) => (
        <div className="seat-chip" role="listitem" key={s.name} data-button={s.button ? '' : undefined}>
          <span className="t">{s.name}</span>
          {s.button && <span className="mark">has the button</span>}
          <span>{s.note}</span>
        </div>
      ))}
    </div>
  );
}

export function Positions() {
  const seats = SIX_MAX_FORMAT.players;

  return (
    <LessonPage slug="positions">
      <p>
        Poker is played in a circle, and the circle has an order. Whoever speaks last has heard
        everybody else first, which is the single biggest structural edge in the game. Where you sit
        relative to the button decides how much of that you get.
      </p>

      <h2>Heads-up</h2>
      <p>
        With two players the roles double up. The button posts the small blind, and it acts{' '}
        <strong>first</strong> before the flop and <strong>last</strong> on every street after it. That
        catches everybody out once: the seat with the positional advantage is the seat that has to open
        the betting preflop. The big blind has already put in the larger forced bet and gets to answer.
      </p>

      <Figure caption="Heads-up: two seats, and the button is also the small blind.">
        <Seats seats={HEADS_UP} label="Heads-up seats" />
      </Figure>

      <h2>Six handed</h2>
      <p>
        With {seats} seats the names spread out. Before the flop the action starts to the left of the
        big blind and runs round to it, so the blinds speak last. After the flop it starts with the
        small blind and ends on the button, every street, until the hand is over.
      </p>

      <Figure caption={`Six-max seats in preflop order. After the flop the order restarts at the small blind.`}>
        <Seats seats={SIX_MAX} label="Six-max seats" />
      </Figure>

      <h2>Why it matters</h2>
      <p>
        Acting last means you have seen what everybody else did before you have to commit. You can
        fold hands that a bet has just made worthless, call thinly when nobody showed strength, and
        make a bet that only has to get through one player instead of five. The same two cards are
        worth playing on the button and worth folding under the gun, which is why a range is always
        quoted for a position and never on its own.
      </p>
      <p>
        The practical version: play more hands the closer you are to the button, and fewer the further
        you are from it. Out of position, prefer the hands that can make something clear on their own
        rather than the ones that need to be steered.
      </p>
    </LessonPage>
  );
}
