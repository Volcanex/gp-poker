# @opentable/identity

Pure, isomorphic package: generated CamelCase names (`RedTiger`,
`SlyRunningFox`) and deterministic geometric avatars (`avatarSvg`), used by
both the server (guest and bot naming) and the client (rendering avatars
from a user id). No dependencies, no node imports.

- `src/words.ts` — the adjective/thing/verb lists. Every word is
  capitalised, letters only, 3-9 characters, and unique across all three
  lists; `test/words.test.ts` enforces this.
- `generateName(rng, words)` takes the rng as an argument rather than
  calling `Math.random` itself, so tests and the server's seeded bot roster
  get reproducible names from the same code path.
- `avatarSvg(seed, size)` hashes the seed with `xmur3`/`mulberry32` (also
  exported, and reused by `seededRng` for the bot roster) into a hue and a
  figure choice, then draws the figure with a handful more draws from the
  same generator. Same seed always yields byte-identical SVG.
