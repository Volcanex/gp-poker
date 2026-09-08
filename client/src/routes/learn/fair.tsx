import { LessonPage } from './lesson.tsx';
import { LatestHandLink } from './latest-hand.tsx';

/* The two numbers quoted here, a 32 byte seed and a 52 card deck, live in
   packages/engine/src/random.ts. They are written out rather than imported
   because importing the engine pulls its hand evaluator's lookup table into
   the bundle, which is the same reason the replay route is lazy loaded. */

export function Fair() {
  return (
    <LessonPage slug="fair">
      <p>
        Online poker asks you to believe the deck was not stacked. You should not have to. Every hand
        here is dealt from a deck the server commits to <strong>before</strong> it sees anybody's
        cards, and publishes the recipe for afterwards, so you can rebuild the deck yourself and check
        it was the one you were dealt from.
      </p>

      <h2>The commitment</h2>
      <p>
        Before a hand is dealt, the server generates a random 32 byte seed and shows you the SHA-256
        hash of it. That hash is on screen from the first card, in the header above the table. It
        gives nothing away: you cannot work backwards from a hash to the seed. What it does is pin the
        server down. Whatever the deck turns out to be, it was already decided at that moment and
        cannot be changed once the betting starts.
      </p>

      <h2>The reveal</h2>
      <p>
        When the hand ends, the seed itself is published. Now the hash can be checked: hash the seed
        you were given and compare it to the one you were shown before the deal. If they match, the
        server did not swap the deck partway through, because it could not have found another seed
        with the same hash.
      </p>

      <h2>The shuffle</h2>
      <p>
        The seed does not just prove the deck, it <em>is</em> the deck. The order of all 52 cards is
        derived from it and nothing else, so the same seed always produces the same shuffle:
      </p>
      <ol>
        <li>
          The seed is used as an HMAC-SHA256 key over a counter, 0, 1, 2 and so on. Each block of that
          is 32 bytes of output, consumed in order and refilled from the next counter value when it
          runs out. That is the random stream.
        </li>
        <li>
          Numbers are drawn from the stream by rejection sampling, which keeps every card equally
          likely rather than slightly favouring the low ones the way a plain remainder would.
        </li>
        <li>
          Those numbers drive a Fisher-Yates shuffle over an ordered 52 card deck, walking from the
          last card down and swapping each with an earlier one.
        </li>
        <li>
          The deal is then fixed: two cards to each seat in turn starting left of the button, one card
          each and then the second, and the next five cards are the board. There are no burn cards, so
          there is nothing unaccounted for.
        </li>
      </ol>

      <h2>Checking a hand yourself</h2>
      <p>
        Open any finished hand's replay page. It has a <strong>Shuffle</strong> panel at the bottom
        showing the commitment and the seed, and underneath it two checks that run{' '}
        <strong>in your browser</strong>, not on the server: the seed is rehashed and compared to the
        commitment, and the deck is re-derived from the seed and dealt out again, then compared card
        by card with the hole cards and board that were recorded. Nothing in that panel is taken on
        trust from the server. During a live hand the same commitment is in the table header beside a
        Verify link, which opens the same view once the seed has been published.
      </p>
      <p>
        <LatestHandLink label="Open a real hand and check it" />
      </p>
      <p>
        What this does not prove is anything about the other players, and it is worth being straight
        about that. A provably fair shuffle says the deck was honest. It says nothing about collusion
        or bots, which are a different problem with different defences.
      </p>
    </LessonPage>
  );
}
