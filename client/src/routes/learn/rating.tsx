import { SIX_MAX_FORMAT } from '@opentable/protocol';
import { LessonPage } from './lesson.tsx';
import { PROVISIONAL_RD, START_RATING, START_RD } from './constants.ts';

export function Rating() {
  const seats = SIX_MAX_FORMAT.players;

  return (
    <LessonPage slug="rating">
      <p>
        There is no money here and no chips to buy. Chips are table units that reset the moment a
        match ends. The one thing you keep is a rating, which is the whole point of the site: it is
        the scarce thing, and it only moves by playing.
      </p>

      <h2>Glicko-2, briefly</h2>
      <p>
        Ratings use Glicko-2, the system chess sites use. It tracks two numbers about you rather than
        one. The first is your <strong>rating</strong>, which everybody starts on{' '}
        <strong>{START_RATING}</strong>. The second is your <strong>rating deviation</strong>, which
        is how sure the system is about that number. A new player starts at a deviation of{' '}
        {START_RD}, meaning it has no idea yet, and it narrows as you play.
      </p>
      <p>
        The deviation is why two players can win the same match and move by different amounts. Beating
        somebody the system is confident about tells it a lot, so your rating moves a long way.
        Beating somebody it knows nothing about tells it very little. Stop playing for a while and
        your deviation widens again on its own, because a rating earned two years ago is not evidence
        about you today.
      </p>
      <p>
        While your deviation is above <strong>{PROVISIONAL_RD}</strong> you are{' '}
        <strong>provisional</strong>: the number is shown but it is still settling, and you are kept
        off the leaderboard until it comes down. That takes a handful of rated matches, not dozens.
      </p>

      <h2>One rating per format</h2>
      <p>
        Heads-up and six-max are rated separately, the way a chess site keeps bullet and blitz apart.
        A six-max result never moves your heads-up rating. They are different games: one is a duel and
        the other is a sit-and-go you can go out of in fifth place. The leaderboard has a ladder for
        each.
      </p>
      <p>
        Casual matches move nothing at all. Practice against bots moves nothing either. Rated matches
        against a bot <strong>do</strong> count, which is a deliberate bootstrap choice while the site
        is new: with nobody around to play, a rating that could never move would be worse than one
        seeded against opponents of a known strength. It is the first thing to revisit once there are
        enough people here.
      </p>

      <h2>How six-max is scored</h2>
      <p>
        A sit-and-go is not five separate matches, and it would be wrong to score it as though you had
        played the field one at a time. Instead the whole table settles as a single Glicko-2 rating
        period. You are given one result against each of the other {seats - 1} seats, decided purely
        by finishing place: a win against everybody who went out before you, a loss to everybody who
        outlasted you, and a draw with anybody who finished level. Those {seats - 1} results are
        applied together, once.
      </p>
      <p>
        Heads-up reduces to exactly the same thing with one opponent, which is why the two formats can
        share one implementation and still mean what they should.
      </p>

      <h2>Peak</h2>
      <p>
        Your profile also shows a peak, which is the highest rating you have held in that format and
        the date you held it. It is a high-water mark, not an average, so it never falls. It is there
        because a rating on its own tells you where you are and nothing about where you have been.
      </p>
    </LessonPage>
  );
}
