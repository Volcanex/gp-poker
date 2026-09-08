/* Copies the country flags this site draws out of the `flag-icons` package
   (MIT licensed, Panayiotis Lipiridis, github.com/lipis/flag-icons) and writes
   the two country lists that go with them.

   Usage, from the repo root or anywhere:

       node client/scripts/flags.mjs [path to a flag-icons package]

   The default source is `node_modules/flag-icons`, which `npm i -D flag-icons`
   puts there. An extracted `npm pack flag-icons` tarball works just as well,
   which is how these were first generated: the package is not a dependency of
   this repo. The SVGs are committed instead, because a flag beside a name is
   not worth a runtime dependency, and this script is how they are refreshed
   when the upstream artwork changes.

   What it writes:
     client/public/flags/<cc>.svg   the 4x3 artwork, one per country
     client/src/ui/countries.ts     code to English short name, for the picker
     server/src/countries.ts        the same codes, for validating a PATCH

   Only entries the package marks `iso` are copied. The rest are regions,
   unions and dependencies (gb-sct, eu, xk, un) that are not an ISO 3166-1
   alpha-2 code, and the server would not accept one. */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const clientDir = resolve(here, '..');
const repoDir = resolve(clientDir, '..');
const source = resolve(process.argv[2] ?? join(repoDir, 'node_modules', 'flag-icons'));

const countries = JSON.parse(readFileSync(join(source, 'country.json'), 'utf8'))
  .filter((c) => c.iso)
  .map((c) => ({ code: c.code.toLowerCase(), name: c.name }))
  .sort((a, b) => a.name.localeCompare(b.name, 'en'));

if (countries.length < 200) {
  throw new Error(`${source} yielded only ${countries.length} countries, which is not a flag-icons package`);
}

const flagsDir = join(clientDir, 'public', 'flags');
mkdirSync(flagsDir, { recursive: true });
for (const file of readdirSync(flagsDir)) {
  if (file.endsWith('.svg')) rmSync(join(flagsDir, file));
}
for (const { code } of countries) {
  copyFileSync(join(source, 'flags', '4x3', `${code}.svg`), join(flagsDir, `${code}.svg`));
}

const version = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).version;
const provenance = `flag-icons ${version} (MIT), refreshed by client/scripts/flags.mjs`;

writeFileSync(
  join(clientDir, 'src', 'ui', 'countries.ts'),
  `/* Generated. Do not edit by hand: ${provenance}.

   Every code here has artwork at /flags/<code>.svg, and the same codes are
   listed in server/src/countries.ts, which is what a PATCH is validated
   against. The two files are deliberate duplicates rather than a field on
   @opentable/protocol: the wire contract has no business carrying 249 English
   country names, and only this side needs the names at all. A server test
   imports both and fails if they drift. */

export interface Country {
  code: string; // lowercase ISO 3166-1 alpha-2
  name: string; // English short name, as the picker lists it
}

/* Sorted by name, which is the order the picker offers them in. */
export const COUNTRIES: Country[] = [
${countries.map((c) => `  { code: '${c.code}', name: ${JSON.stringify(c.name)} },`).join('\n')}
];

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));

export function isCountryCode(code: unknown): code is string {
  return typeof code === 'string' && BY_CODE.has(code.toLowerCase());
}

/* The name to put in a flag's alt text. An unknown code keeps its own letters
   rather than reading as nothing: a client can outlive the list it shipped
   with, and a two letter alt is still better than an unlabelled image. */
export function countryName(code: string): string {
  return BY_CODE.get(code.toLowerCase())?.name ?? code.toUpperCase();
}
`
);

writeFileSync(
  join(repoDir, 'server', 'src', 'countries.ts'),
  `/* Generated. Do not edit by hand: ${provenance}.

   The codes a player may set as their country, and nothing else: the names
   live in client/src/ui/countries.ts, which is the only side that prints them.
   The two lists are duplicated on purpose and **must hold exactly the same
   codes**; server/test/country.test.ts imports both and fails if they drift. */

export const COUNTRY_CODES: readonly string[] = [
${countries.map((c) => `  '${c.code}',`).join('\n')}
];

const VALID = new Set(COUNTRY_CODES);

/* What a PATCH may set. \`null\` clears the flag and is a valid choice; anything
   that is not a code on the list is \`undefined\`, which the route refuses. */
export function readCountry(raw: unknown): string | null | undefined {
  if (raw === null) return null;
  if (typeof raw !== 'string') return undefined;
  const code = raw.trim().toLowerCase();
  if (code === '') return null;
  return VALID.has(code) ? code : undefined;
}
`
);

console.log(`wrote ${countries.length} flags, client/src/ui/countries.ts and server/src/countries.ts from ${provenance}`);
