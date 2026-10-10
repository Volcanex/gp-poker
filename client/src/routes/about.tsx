import { Link } from 'react-router-dom';
import { useTitle } from '../ui/title.ts';
import './learn/learn.css';

/* What the site is and who made it. Plain prose on the lesson layout's
   `.prose`, so it reads like the rest of the written pages. The description
   in server/src/meta.ts says the same thing in one line. */
export function About() {
  useTitle('About');
  return (
    <main className="page stack">
      <h1 className="h1">About</h1>
      <div className="prose">
        <p>
          EveryonePoker is free no-limit hold'em with a rating. No money changes hands, there are no
          ads and there is no rake. You play for the number next to your name and for the game itself.
        </p>

        <h2>What is here</h2>
        <ul>
          <li>Heads-up matches and six-max sit-and-gos, fast or standard, ranked or casual.</li>
          <li>Practice tables against bots at seven levels, from a calling station to a solver.</li>
          <li>Tournaments, hourly arenas, challenge links and home games for playing friends.</li>
          <li>
            <Link to="/learn">Lessons</Link>, <Link to="/puzzles">daily puzzles</Link>,{' '}
            <Link to="/tools">tools</Link>, and a replay of every hand you play.
          </li>
        </ul>

        <h2>Fair by construction</h2>
        <p>
          Every deck is committed to before it is dealt and published afterwards, so any hand can be
          checked in your own browser. <Link to="/learn/fair">How that works</Link>. Ratings are
          Glicko-2, explained on <Link to="/learn/rating">how the rating works</Link>.
        </p>

        <h2>Who made it</h2>
        <p>
          Built by <a href="https://gabrielpenman.com" target="_blank" rel="noreferrer">Gabriel Penman</a>,
          after wanting a poker site that felt the way lichess feels for chess: free, quick to start
          and honest about how it works. The code is{' '}
          <a href="https://github.com/Volcanex/gp-poker" target="_blank" rel="noreferrer">open source</a> under the AGPL,
          and that is also the place to report a bug or ask for something.
        </p>
      </div>
    </main>
  );
}
