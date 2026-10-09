# @opentable/identity

Pure, isomorphic package: generated CamelCase names (`RedTiger`,
`SlyRunningFox`) and deterministic geometric avatars (`avatarSvg`), used by
both the server (guest and bot naming) and the client (rendering avatars
from a user id). No dependencies, no node imports.

- `src/words.ts`: the adjective/thing/verb lists. Every word is
  capitalised, letters only, 3-9 characters, and unique across all three
  lists; `test/words.test.ts` enforces this.
- `generateName(rng, words)` takes the rng as an argument rather than
  calling `Math.random` itself, so tests and the server's seeded bot roster
  get reproducible names from the same code path. This is what mints a
  **guest's** name; it is untouched by the population work below.
- `avatarSvg(seed, size)` hashes the seed with `xmur3`/`mulberry32` (also
  exported, and reused by `seededRng` for the bot roster) into a hue and a
  figure choice, then draws the figure with a handful more draws from the
  same generator. Same seed always yields byte-identical SVG.
- `src/realistic.ts`: `generateRealisticIdentity(rng)`, the population bots'
  name generator. Deliberately a different shape from `generateName`: a
  first name or a poker-handle word, cased the way a person actually types
  (mostly lowercase or Capitalised, rarely SHOUTING), with a number or an
  underscore, an initial, or nothing at all, never two dictionary words
  glued together, which is exactly the CamelCase shape this generator exists
  not to look like. Every name it produces matches `REALISTIC_NAME_RE`
  (letters, digits, underscore, 3-20 characters), the same character set
  `NAME_RE` in `server/src/auth.ts` accepts from a human claiming a name, so
  a bot's handle reads as one a person could have typed at signup.
  `COUNTRY_POOLS` is a weighted table of first-name lists per country
  (US the largest single share, then a descending list down to a long tail of
  smaller pools) and is where the country half of a bot's identity comes
  from: `generateRealisticIdentity` returns `{ name, country }` together
  because the name is drawn from that country's own pool. `server/src/bots/`
  layers everything else a population bot needs (timezone, persona, schedule)
  on top of this, since those need `@opentable/protocol` types this package
  deliberately has no dependency on.
