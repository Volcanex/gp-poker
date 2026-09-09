import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BOT_LEVELS, SPEEDS, SPEED_NAME } from '@opentable/protocol';
import type { BotLevel, Mode, Speed } from '@opentable/protocol';
import { api } from '../net/api.ts';
import { levelAverageRating } from '../net/adapt.ts';
import type { BotRow } from '../net/types.ts';
import { readPlayChoice, useSession } from '../net/session.tsx';
import { MODES, MODE_NAME } from '../ui/mode-tabs.tsx';
import { Segmented } from '../ui/segmented.tsx';
import { useTitle } from '../ui/title.ts';
import { modeBlurb } from './home.tsx';
import './home.css';
import './bots.css';

/* The setup page behind the home panel's `More`: the same practice a preset
   button starts, with the table, the speed, the level and the roster all
   spelled out first, because "on the bots screen we can get specific."
   Starting a game here goes through the same `startPractice` the home
   presets use, so a table built from here and one built from a preset agree
   on what practice means down to the wire message. */
export function BotsPage() {
  useTitle('Practice against bots');
  const nav = useNavigate();
  const { queue, startPractice, clearFound, offline, ready } = useSession();

  const last = readPlayChoice();
  const [mode, setMode] = useState<Mode>(last?.mode ?? 'six-max');
  const [speed, setSpeed] = useState<Speed>(last?.speed ?? 'standard');
  const [level, setLevel] = useState<BotLevel>(4);
  const [bots, setBots] = useState<BotRow[]>([]);

  useEffect(() => {
    let live = true;
    api
      .bots()
      .then((rows) => live && setBots(rows))
      .catch(() => {
        /* the page still works; it just cannot show what anybody is rated */
      });
    return () => {
      live = false;
    };
  }, []);

  /* The same one-shot ticket to the table the home page uses: `queue.s` is
     shared session state, not something this page owns, so a match started
     here is walked to exactly the way one started from a preset is. */
  useEffect(() => {
    if (queue.s === 'found' && queue.m) {
      const m = queue.m;
      clearFound();
      nav(`/m/${m}`);
    }
  }, [queue.s, queue.m, nav, clearFound]);

  const busy = !ready || offline || queue.s === 'searching';

  return (
    <main className="page stack bots-page">
      <section className="hero">
        <h1 className="h1">Practice against bots</h1>
        <p className="lede">Set the table, pick a level, and press play. Practice matches are never rated.</p>
      </section>

      <div className="card bots-setup">
        <div className="play-toggles">
          <Segmented
            label="Table size"
            options={MODES.map((m) => ({ value: m, label: MODE_NAME[m] }))}
            value={mode}
            onPick={setMode}
          />
          <Segmented
            label="Speed"
            options={SPEEDS.map((sp) => ({ value: sp, label: SPEED_NAME[sp] }))}
            value={speed}
            onPick={setSpeed}
          />
        </div>
        <span className="muted">{modeBlurb(mode, speed)}</span>

        <div className="level-picker" role="radiogroup" aria-label="Bot level">
          {BOT_LEVELS.map((b) => {
            const atLevel = bots.filter((bot) => bot.level === b.level);
            const avg = levelAverageRating(bots, b.level, mode);
            return (
              <label key={b.level} className="level-row" data-checked={level === b.level ? '' : undefined}>
                <input
                  type="radio"
                  className="radio"
                  name="bot-level"
                  checked={level === b.level}
                  onChange={() => setLevel(b.level)}
                />
                <span className="level-row-body">
                  <span className="level-row-head">
                    <span className="t">{b.name}</span>
                    <span className="badge badge-plain num">
                      {avg == null ? 'No rated matches yet' : `Rated ${avg}`}
                    </span>
                  </span>
                  <span className="muted">{b.description}</span>
                  {atLevel.length > 0 && (
                    <ul className="level-bots">
                      {atLevel.map((bot) => (
                        <li key={bot.id}>
                          <span className="n">{bot.name}</span>
                          <span className="num">{bot.ratings[mode].rating}</span>
                          <span className="muted num">{bot.ratings[mode].matches} matches</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </span>
              </label>
            );
          })}
        </div>

        {queue.error && <span className="badge badge-warn">{queue.error}</span>}

        <button
          type="button"
          className="btn btn-primary btn-lg"
          disabled={busy}
          onClick={() => startPractice(mode, level, speed)}
        >
          Play
        </button>
      </div>
    </main>
  );
}
