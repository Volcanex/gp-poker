import { useCallback, useEffect, useRef, useState } from 'react';
import { GearSix } from '@phosphor-icons/react';
import { useGInit, useMedia } from './bits.tsx';
import { ACCENTS, CARD_LAYOUTS, CARD_SIZES, HAND_METAS, PALETTES, TABLE_INFO, THEMES, applyPrefs, defaultAccentFor, readPrefs, writePrefs, SEAT_DETAILS } from './prefs.ts';
import type { AccentId, CardLayout, CardSize, HandMeta, PaletteId, Prefs, TableInfo, ThemeChoice, SeatDetail } from './prefs.ts';
import { Segmented } from './segmented.tsx';
import { useSoundSettings } from '../sound/react.ts';
import { PictureDialog } from './picture-dialog.tsx';
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
  const menuRef = useRef<HTMLDivElement>(null);
  const pictureRef = useRef<HTMLDialogElement>(null);
  useGInit(wrapRef);
  const [prefs, setPrefs] = useState<Prefs>(() => readPrefs());
  /* The same 560 the felt's narrow container query and `table/table.tsx`
     use: the one width class where the other seats have a phone reading. */
  const phone = useMedia('(max-width: 560px)');

  /* g-ui measures a tab strip's sliding indicator when it initialises the
     strip, and a popover that has never been open measures nought: the two
     switchers in here came up with an indicator no pixels wide, leaving the
     label's weight as the only thing saying which option was on. Re-selecting
     the tab that is already selected is what puts the indicator back, and it
     is exactly what a click does, so opening the menu clicks it once. */
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return undefined;
    const onToggle = (e: Event) => {
      if ((e as unknown as { newState?: string }).newState !== 'open') return;
      /* Two controls live outside this menu and write the same record
         (`updatePrefs` in `./prefs.ts`): the `x` on the key legend and the
         chevron on the game panel. This component mounts once for the whole
         app, so without re-reading on open its copy is whatever it was at
         first paint and the next thing changed in here would put a dismissed
         legend back. */
      setPrefs(readPrefs());
      menu.querySelectorAll<HTMLButtonElement>('.tabs .tab[aria-selected="true"]')
        .forEach((tab) => tab.click());
    };
    menu.addEventListener('toggle', onToggle);
    return () => menu.removeEventListener('toggle', onToggle);
  }, []);

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

  /* A palette arrives wearing an accent. Choosing one takes that accent unless
     the player has already moved off the accent the palette they are leaving
     came with, which is the only way to tell a chosen accent from a default
     one without storing a second flag for it. */
  const choosePalette = useCallback((id: PaletteId) => {
    setPrefs((p) => {
      const chosen = p.accent !== defaultAccentFor(p.palette);
      const next: Prefs = {
        ...p,
        palette: id,
        accent: chosen ? p.accent : defaultAccentFor(id),
      };
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
        <GearSix size={20} aria-hidden="true" />
        Settings
      </button>

      <div
        className="menu settings-menu"
        popover="auto"
        id="settings-menu"
        aria-label="Settings"
        ref={menuRef}
      >
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

        {/* The games room carries its own coordinated set, so the palette and
            accent rows are not offered while it is on. */}
        {prefs.theme !== 'room' && (<>
        <hr className="separator" />

        <div className="menu-title" id="settings-palette">Palette</div>
        <div className="pswatches" role="radiogroup" aria-labelledby="settings-palette">
          {PALETTES.map((p) => (
            <button
              key={p.id}
              type="button"
              className="pswatch"
              role="radio"
              aria-checked={prefs.palette === p.id}
              title={p.label}
              onClick={() => choosePalette(p.id)}
            >
              <span
                className="ps-chip"
                data-palette={p.id}
                data-accent={p.accent === 'default' ? undefined : p.accent}
                aria-hidden="true"
              >
                <span className="ps-a" />
              </span>
              <span className="ps-n">{p.label}</span>
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
        </>)}

        <hr className="separator" />

        <div className="menu-title">You</div>
        <div className="switch-row">
          <span className="label">Picture</span>
          <button
            type="button"
            className="btn btn-tertiary btn-sm"
            onClick={() => {
              /* The menu is a popover over the whole page, so it goes before a
                 modal opens rather than sitting on top of the backdrop. */
              document.getElementById('settings-menu')?.hidePopover();
              pictureRef.current?.showModal();
            }}
          >
            Edit picture
          </button>
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

        {/* How your own two cards are laid out on the band, and how big they
            are drawn. Both take a row of their own rather than the control
            column a switch-row gives: three words on a switcher do not fit
            beside a label in a menu this narrow. They are here rather than
            under Table because they are about the cards, which is also the
            only group the four colour deck could sit in. */}
        <div className="seg-row">
          <span className="label">Layout</span>
          <Segmented
            options={CARD_LAYOUTS.map((c) => ({ value: c.id, label: c.label }))}
            value={prefs.cards}
            onPick={(v) => update({ cards: v as CardLayout })}
            label="Card layout"
          />
        </div>

        <div className="seg-row">
          <span className="label">Size</span>
          <Segmented
            options={CARD_SIZES.map((c) => ({ value: c.id, label: c.label }))}
            value={prefs.cardSize}
            onPick={(v) => update({ cardSize: v as CardSize })}
            label="Card size"
          />
        </div>

        {/* On a phone the felt sets the other seats' size itself, so the
            size row would be a control that answers nothing; what a phone
            chooses is the compact row or the full-width strip. */}
        {phone ? (
          <div className="seg-row">
            <span className="label">Other seats</span>
            <Segmented
              options={SEAT_DETAILS.map((c) => ({ value: c.id, label: c.label }))}
              value={prefs.seatDetail}
              onPick={(v) => update({ seatDetail: v as SeatDetail })}
              label="Seat detail"
            />
          </div>
        ) : (
          <div className="seg-row">
            <span className="label">Other seats</span>
            <Segmented
              options={CARD_SIZES.map((c) => ({ value: c.id, label: c.label }))}
              value={prefs.seatCards}
              onPick={(v) => update({ seatCards: v as CardSize })}
              label="Seat card size"
            />
          </div>
        )}

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

        {/* Where the hand's facts and the match's actions are read from: one
            card in the top bar's own corner, or the stats box back in the
            seat six-max leaves empty and heads-up leaves whole. A row of its
            own, the way Layout and Size take theirs, because "In a panel"
            and "In the seat" do not fit beside a label in a menu this
            narrow. */}
        <div className="seg-row">
          <span className="label">Hand info</span>
          <Segmented
            options={TABLE_INFO.map((t) => ({ value: t.id, label: t.label }))}
            value={prefs.tableInfo}
            onPick={(v) => update({ tableInfo: v as TableInfo })}
            label="Hand info placement"
          />
        </div>

        {/* Your own name, stack, button marker and rack: under your two cards
            on the band, or on a line of its own over the controls. A row of
            its own for the same reason Hand info takes one. */}
        <div className="seg-row">
          <span className="label">Your line</span>
          <Segmented
            options={HAND_METAS.map((m) => ({ value: m.id, label: m.label }))}
            value={prefs.handMeta}
            onPick={(v) => update({ handMeta: v as HandMeta })}
            label="Your line placement"
          />
        </div>

        {/* The way back for the `x` on the legend itself. A caption for a
            keyboard is worth dismissing once you know the keys, and worth
            being able to ask for again when you have forgotten them. */}
        <label className="switch-row">
          <span className="label">Key legend</span>
          <input
            type="checkbox"
            className="switch"
            checked={prefs.keyLegend}
            onChange={(e) => update({ keyLegend: e.target.checked })}
          />
        </label>

        <hr className="separator" />

        <div className="menu-title">Country</div>
        {/* The flag beside your name at every table. Its own control rather
            than a list of choices here: 249 of them is a search, not a menu.
            Same row shape as every other setting: a label, then a control the
            same height as the rest. */}
        <div className="switch-row">
          <span className="label">Flag</span>
          <CountryPicker label="Country" />
        </div>

        <hr className="separator" />
        <SoundSection />
      </div>

      {/* Outside the menu on purpose: a dialog rendered inside `.settings-menu`
          inherits the widths that menu gives its own controls. */}
      <PictureDialog ref={pictureRef} />
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
