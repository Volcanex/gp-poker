# Sound

Small, framework-free sound module: a Web Audio engine, three swappable
packs, and a `useSoundSettings()` hook for the settings menu. Nothing here
is wired into the table or settings UI yet; see "Integration points" below
for what the next agent needs to call.

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
  code-splits every pack into its own chunk (confirmed with a throwaway
  build: felt, arcade and glass each build separately
  from the entry).
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

All 37 vendored sounds verified Kenney/CC0 against both the module header
and soundcn's registry.json, with zero matches against the forbidden
Warcraft/Blizzard patterns. "Source pack" is the actual Kenney itch.io
pack the file matched by name in soundcn's assets mirror; five sounds
(marked `Kenney (unmirrored)`) aren't present in that mirror by filename
but are independently verified via soundcn's registry metadata (author,
licence, category all clean).

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

All well under the 250 KB per-pack budget.

## Integration points

Two things the table/settings agent needs to wire up; nothing in this
directory calls them itself:

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
