import { useCallback, useEffect, useRef, useState } from 'react';
import { useGInit } from './bits.tsx';
import { ACCENTS, THEMES, applyPrefs, readPrefs, writePrefs } from './prefs.ts';
import type { AccentId, Prefs, ThemeChoice } from './prefs.ts';
import { useSoundSettings } from '../sound/react.ts';
import { CountryPicker } from './country-picker.tsx';
import type { PackId } from '../sound/index.ts';

/* One panel for everything about how the table looks and sounds. It replaced a
   button that cycled the theme, which meant the only way to find out what the
   third press did was to press it twice.

   The panel is g's `.menu` popover holding g's own controls rather than a list
   of commands, so the choices are radio groups and switches and are labelled
   as such: a menu role over a set of switches announces the wrong thing. */
export function SettingsMenu() {
  const wrapRef = useRef<HTMLDivElement>(null);
  useGInit(wrapRef);
  const [prefs, setPrefs] = useState<Prefs>(() => readPrefs());

  /* index.html has already stamped the attributes before first paint. This
     re-applies on mount so a stored record written by an older build, or one
     the parser had to fall back on, ends up on screen as it reads here. */
  useEffect(() => {
    applyPrefs(prefs, document.documentElement);
  }, [prefs]);

  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      writePrefs(next);
      return next;
    });
  }, []);

  return (
    <div className="settings" ref={wrapRef}>
      <button
        type="button"
        className="btn btn-tertiary btn-sm"
        popoverTarget="settings-menu"
        aria-haspopup="dialog"
      >
        Settings
      </button>

      <div className="menu settings-menu" popover="auto" id="settings-menu" aria-label="Settings">
        <div className="menu-title" id="settings-theme">Theme</div>
        <div className="choices" role="radiogroup" aria-labelledby="settings-theme">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              className="choice"
              role="radio"
              aria-checked={prefs.theme === t.id}
              onClick={() => update({ theme: t.id as ThemeChoice })}
            >
              {t.label}
            </button>
          ))}
        </div>

        <hr className="separator" />

        <div className="menu-title" id="settings-accent">Accent</div>
        <div className="swatches" role="radiogroup" aria-labelledby="settings-accent">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              type="button"
              className="swatch"
              role="radio"
              aria-checked={prefs.accent === a.id}
              aria-label={a.label}
              title={a.label}
              data-accent={a.id === 'default' ? undefined : a.id}
              onClick={() => update({ accent: a.id as AccentId })}
            />
          ))}
        </div>

        <hr className="separator" />

        <div className="menu-title">Cards</div>
        <label className="switch-row">
          <span className="label">Four colour deck</span>
          <input
            type="checkbox"
            className="switch"
            checked={prefs.fourColour}
            onChange={(e) => update({ fourColour: e.target.checked })}
          />
        </label>

        <hr className="separator" />

        <div className="menu-title">Table</div>
        {/* The phone's v2 band puts the controls under the thumb, so it has to
            be told which edge the thumb is on. */}
        <label className="switch-row">
          <span className="label">Left-handed</span>
          <input
            type="checkbox"
            className="switch"
            checked={prefs.hand === 'left'}
            onChange={(e) => update({ hand: e.target.checked ? 'left' : 'right' })}
          />
        </label>

        <hr className="separator" />

        <div className="menu-title">Country</div>
        {/* The flag beside your name at every table. Its own control rather
            than a list of choices here: 249 of them is a search, not a menu. */}
        <CountryPicker label="Country" />

        <hr className="separator" />
        <SoundSection />
      </div>
    </div>
  );
}

/* Sound is its own module with its own store and its own key: it is not a
   thing about how the table looks, and somebody playing with the sound off in
   a light theme is the normal case rather than a contradiction. */
function SoundSection() {
  const { enabled, volume, pack, packs, setEnabled, setVolume, setPack, unlock, play } =
    useSoundSettings();

  const preview = async () => {
    await unlock();
    await play('yourTurn');
  };

  return (
    <>
      <div className="menu-title">Sound</div>
      <label className="switch-row">
        <span className="label">Play sounds</span>
        <input
          type="checkbox"
          className="switch"
          checked={enabled}
          onChange={(e) => {
            if (e.target.checked) void unlock();
            setEnabled(e.target.checked);
          }}
        />
      </label>

      <label className="switch-row">
        <span className="label">Volume</span>
        <span className="g-slider">
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(volume * 100)}
            disabled={!enabled}
            aria-label="Volume"
            onChange={(e) => setVolume(Number(e.target.value) / 100)}
          />
        </span>
      </label>

      <label className="switch-row">
        <span className="label">Pack</span>
        <select
          className="select"
          value={pack}
          disabled={!enabled}
          aria-label="Sound pack"
          onChange={(e) => setPack(e.target.value as PackId)}
        >
          {packs.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>

      <button type="button" className="btn btn-tertiary btn-sm preview" disabled={!enabled} onClick={preview}>
        Play a sound
      </button>
    </>
  );
}
