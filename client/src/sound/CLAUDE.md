# Sound

Small, framework-free sound module: a Web Audio engine, four swappable
packs, and a `useSoundSettings()` hook for the settings menu. The callers
live outside this directory: `../table/sounds.ts` plays the table cues,
`../chat/use-chat.ts` the chat one, `../ui/presence.tsx` the match found
alert, `../ui/settings.tsx` shows the controls and `../app.tsx` unlocks the
context on the first gesture. See "Integration points" for the contract.

## Files

- `engine.ts`: the Web Audio layer. It decodes each sound's base64 once,
  caches the `AudioBuffer`, and plays through a `GainNode` at the master
  volume. `unlock()` resumes the `AudioContext` on the first user gesture.
  `play()` is a no-op until unlocked, while disabled, or when
  `AudioContext` doesn't exist (e.g. under jsdom in tests).
- `events.ts`: the `SoundEvent` union and a `soundEvents` array of the
  same values, used by tests and pack authors to check coverage.
- `sound-types.ts`: `SoundAsset`/`SoundModule` (alias), the shape every
  vendored sound file exports. This is soundcn's own data shape, kept
  compatible on purpose so a freshly vendored file only needs its import
  path adjusted, nothing else.
- `packs/<id>/index.ts`: one pack, `{ id, name, description, sounds }`
  where `sounds` is `Record<SoundEvent, SoundModule | null>`. `null` means
  the pack deliberately stays silent for that event.
- `index.ts`: the public API. `sound` (default export) carries `play`,
  `setEnabled`, `setVolume`, `setPack`, `unlock`, `packs` (static
  metadata, no audio loaded), `state`. Persists `{enabled, volume, pack}`
  to `localStorage` under `ot.sound`. Defaults: disabled, volume 0.6,
  pack `felt`. Packs are loaded with a dynamic `import()` keyed by id and
  cached, so switching packs only ever fetches each one once and Vite
  code-splits every pack into its own chunk (confirmed on a build: felt,
  arcade, glass and web each build separately from the entry).
- `react.ts`: `useSoundSettings()`, a thin `useSyncExternalStore` wrapper
  over `sound` for the settings menu.

## Adding a pack

1. Vendor sound modules under `packs/<id>/`, one file per sound, each
   exporting a `SoundAsset` constant matching `sound-types.ts`. If pulled
   from soundcn, the only change needed is the type import path (soundcn
   uses a `@/lib/sound-types` alias this repo doesn't have; point it at
   `../../sound-types.ts` instead, per this repo's convention of explicit
   `.ts` extensions on relative imports).
2. Write `packs/<id>/index.ts` exporting `{ id, name, description, sounds }`
   with every `SoundEvent` key mapped (use `null` for silence, not a
   missing key).
3. Register the pack in `packLoaders` and `PACK_META` in `index.ts` (the
   only two places outside `packs/` that need editing).
4. Verify provenance before vendoring anything (see below) and add a row
   to the table in this file.
5. Keep the pack under 250 KB of base64 total; `du -cb packs/<id>/*.ts`
   (excluding `index.ts`) is a good enough proxy since the base64 payload
   dominates file size.

A pack does not have to be vendored. `web` is generated (see below), so its
modules and its `index.ts` are written by a script and hand-edits to them
are lost on the next run.

## Verifying provenance

soundcn's per-module `license`/`author` fields are **not trustworthy on
their own**. Sounds pulled from the World of Warcraft collection (e.g.
`bell-toll-alliance`, `i-quest-complete`, `ui-blizzard-store-confirm-purchase`,
the `voiceover-pack-*` family) carry an embedded `license: "CC0", author:
"Kenney"` that contradicts soundcn's own registry.json, which correctly
lists them as `© Blizzard Entertainment, Inc.`, all rights reserved, under
a `warcraft` category tag. Before vendoring any sound, cross-check the
module against soundcn's registry.json `items[].author` and
`items[].meta.license`, not just the module's own fields, and reject
anything tagged `warcraft` or named after a forbidden pattern (`bell-toll`,
`blizzard`, `voiceover-pack`, `quest`, `alliance`, `horde`, `night-elf`).
The test suite re-checks this on every vendored file.

## Provenance table

All 37 *vendored* sounds verified Kenney/CC0 against both the module header
and soundcn's registry.json, with zero matches against the forbidden
Warcraft/Blizzard patterns. "Source pack" is the actual Kenney itch.io
pack the file matched by name in soundcn's assets mirror; five sounds
(marked `Kenney (unmirrored)`) aren't present in that mirror by filename
but are independently verified via soundcn's registry metadata (author,
licence, category all clean). The `web` pack's 15 sounds are not vendored at
all: they are synthesised in this repo and carry `author: "Open Table"`,
which is why the provenance test checks the author per pack rather than
expecting Kenney everywhere.

| Sound module | Used for | Pack(s) | Source pack | Licence |
|---|---|---|---|---|
| card-slide-1 | deal | felt | Kenney Casino Audio | CC0 |
| card-place-1 | cardPlace | felt | Kenney Casino Audio | CC0 |
| card-place-2 | check | felt | Kenney Casino Audio | CC0 |
| card-shove-1 | fold | felt | Kenney Casino Audio | CC0 |
| chip-lay-1 | bet | felt | Kenney Casino Audio | CC0 |
| chip-lay-2 | call | felt | Kenney Casino Audio | CC0 |
| chips-collide-1 | chipsCollect | felt | Kenney Casino Audio | CC0 |
| notification-pop | yourTurn | felt | Kenney (unmirrored) | CC0 |
| tick-001 | clockWarning | felt | Kenney Interface Sounds | CC0 |
| success-chime | handWon | felt | Kenney (unmirrored) | CC0 |
| drop-001 | handLost | felt | Kenney Interface Sounds | CC0 |
| drop-004 | matchLost | felt | Kenney Interface Sounds | CC0 |
| jingles-hit-01 | matchWon | felt | Kenney Music Jingles (Hit) | CC0 |
| click-soft | chat, click | felt | Kenney (unmirrored) | CC0 |
| click-8bit | deal, cardPlace, check, handLost, matchLost, chat, click | arcade | Kenney (unmirrored) | CC0 |
| select-001 | bet | arcade | Kenney Interface Sounds | CC0 |
| select-002 | call | arcade | Kenney Interface Sounds | CC0 |
| select-003 | fold | arcade | Kenney Interface Sounds | CC0 |
| select-004 | chipsCollect | arcade | Kenney Interface Sounds | CC0 |
| confirmation-001 | yourTurn | arcade | Kenney Interface Sounds | CC0 |
| jump-8bit | clockWarning | arcade | Kenney (unmirrored) | CC0 |
| jingles-nes-01 | handWon | arcade | Kenney Music Jingles (8-Bit) | CC0 |
| jingles-nes-02 | matchWon | arcade | Kenney Music Jingles (8-Bit) | CC0 |
| glass-001 | deal | glass | Kenney Interface Sounds | CC0 |
| glass-002 | bet | glass | Kenney Interface Sounds | CC0 |
| glass-003 | call | glass | Kenney Interface Sounds | CC0 |
| glass-004 | fold | glass | Kenney Interface Sounds | CC0 |
| glass-005 | yourTurn | glass | Kenney Interface Sounds | CC0 |
| glass-006 | clockWarning | glass | Kenney Interface Sounds | CC0 |
| impact-glass-light-000 | cardPlace | glass | Kenney Impact Sounds | CC0 |
| impact-glass-light-001 | check | glass | Kenney Impact Sounds | CC0 |
| impact-glass-light-002 | chipsCollect | glass | Kenney Impact Sounds | CC0 |
| impact-glass-light-003 | handLost | glass | Kenney Impact Sounds | CC0 |
| impact-glass-light-004 | chat, click | glass | Kenney Impact Sounds | CC0 |
| jingles-pizzi-00 | handWon | glass | Kenney Music Jingles (Pizzicato) | CC0 |
| impact-bell-heavy-000 | matchWon | glass | Kenney Impact Sounds | CC0 |
| jingles-steel-05 | matchLost | glass | Kenney Music Jingles (Steel) | CC0 |
| deal | deal | web | Generated, client/scripts/sound-web.mjs | CC0 |
| card-place | cardPlace | web | Generated, client/scripts/sound-web.mjs | CC0 |
| bet | bet | web | Generated, client/scripts/sound-web.mjs | CC0 |
| call | call | web | Generated, client/scripts/sound-web.mjs | CC0 |
| check | check | web | Generated, client/scripts/sound-web.mjs | CC0 |
| fold | fold | web | Generated, client/scripts/sound-web.mjs | CC0 |
| chips-collect | chipsCollect | web | Generated, client/scripts/sound-web.mjs | CC0 |
| your-turn | yourTurn | web | Generated, client/scripts/sound-web.mjs | CC0 |
| clock-warning | clockWarning | web | Generated, client/scripts/sound-web.mjs | CC0 |
| hand-won | handWon | web | Generated, client/scripts/sound-web.mjs | CC0 |
| hand-lost | handLost | web | Generated, client/scripts/sound-web.mjs | CC0 |
| match-won | matchWon | web | Generated, client/scripts/sound-web.mjs | CC0 |
| match-lost | matchLost | web | Generated, client/scripts/sound-web.mjs | CC0 |
| chat | chat | web | Generated, client/scripts/sound-web.mjs | CC0 |
| click | click | web | Generated, client/scripts/sound-web.mjs | CC0 |

### The web pack is synthesised, not sampled

`web` evokes early-2000s desktop and messenger audio, and every sound people
remember from that era, the nudge, the door, the mail chime, the dial-up
handshake, is a copyrighted recording. None of them may be copied, sampled or
rebuilt note for note. So the pack contains no recording at all: fifteen
original sounds built from oscillators and filtered noise by
`client/scripts/sound-web.mjs`, which anyone can rerun to get the same bytes
back. That makes the whole pack CC0 with the repo as its author, and it makes
provenance a property of the script rather than a claim about a file's origin.

The script is plain Node with no dependencies: it writes 22050 Hz mono 16-bit
WAV bytes by hand and base64s them into the modules. Two things in it are less
obvious than they look. Squares and triangles are summed from their harmonics
under a 9.5 kHz guard, because a naive square at 1.2 kHz on a 22 kHz rate folds
its top harmonics back down as grit. And the state-variable bandpass goes
unstable above roughly a third of the sample rate, where it produces NaN and
normalises to a silent file, so anything brighter uses the one-pole highpass
instead and `finish()` throws rather than writing a sound nobody can hear.

`src/test/sound-web.test.ts` is the listening test nobody can do by ear: it
decodes each module's WAV header, and checks the rate, the channel count, the
declared duration, a peak between -6 and -1 dBFS, and near-silence in the first
and last 64 samples so nothing clicks. The turn chime is the one sound
deliberately quieter than the rest, at -5.5 dBFS: it fires on every hand, and a
literal 60 percent of -3 dBFS would fall under that test's floor.

### `chat` reuses each pack's own click

Table chat needed a cue and no new sound was vendored for it. soundcn's
registry.json is what the provenance rule above is checked against, and it
was not reachable from this workstream, so rather than vendor a file on the
strength of its own header (exactly the thing the Warcraft sounds got wrong)
every pack maps `chat` to the quiet cue it already uses for `click`. Replace
these three the moment a verified CC0 notification sound can be vendored.

## Pack sizes (base64 payload, excluding `index.ts`)

| Pack | Total |
|---|---|
| felt | ~69 KB |
| arcade | ~36 KB |
| glass | ~72 KB |
| web | ~169 KB |

All under the 250 KB per-pack budget; `web` is the big one because uncompressed
WAV costs about 59 KB of base64 per second of audio, and the script prints the
running total so a regeneration cannot quietly blow past it.

## Integration points

The two calls the rest of the app makes; nothing in this directory calls
them itself, which is what keeps the module free of table knowledge:

1. **Unlock on first gesture**: call `sound.unlock()` from the first
   `pointerdown` or `keydown` listener at the app root. Browsers block
   audio until a user gesture; calling it more than once is harmless.
2. **Play at table events**: call `sound.play(event)` on a hand
   dealing (`'deal'`), each seat's own action landing (`'cardPlace'`,
   `'bet'`, `'call'`, `'check'`, `'fold'`), chips sweeping to the winner
   (`'chipsCollect'`), it becoming the local player's turn (`'yourTurn'`),
   the action clock dropping under 5s (`'clockWarning'`), a hand ending
   (`'handWon'`/`'handLost'`), and a match ending
   (`'matchWon'`/`'matchLost'`). Use `'click'` for generic UI taps if
   wanted.
3. **Settings section**: bind a toggle, a volume slider, and a pack
   picker to `useSoundSettings()` (`enabled`, `volume`, `pack`, `packs`,
   `setEnabled`, `setVolume`, `setPack`). Add a "Preview" button next to
   the pack picker that calls `play('yourTurn')` (after `unlock()`, since
   a settings-menu click already counts as the user gesture) so a player
   can hear a pack before committing to it.
