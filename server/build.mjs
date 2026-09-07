import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

// Bundles server + the @opentable/* workspace packages into one file. Those
// packages ship no compiled output of their own (their package.json `main`
// points at ./src/index.ts, for tsx in dev) — plain `node` can't execute or
// resolve that, so bundling is what makes `node dist/index.js` possible at
// all. Real npm dependencies stay external and are resolved normally from
// node_modules at runtime.
await build({
  entryPoints: [path.join(here, 'src', 'index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: path.join(here, 'dist', 'index.js'),
  sourcemap: true,
  logLevel: 'info',
  external: ['fastify', '@fastify/*', 'postgres', 'ws'],
});

// @opentable/preflop loads its chart/equity JSON relative to its own source
// file's location at runtime (import.meta.url). Once bundled into one file
// at server/dist/index.js, that same relative path resolves to server/data/
// instead of packages/preflop/data/ — mirror the files there so it finds
// them. See packages/preflop/src/data.ts.
mkdirSync(path.join(here, 'data'), { recursive: true });
cpSync(path.join(repoRoot, 'packages', 'preflop', 'data'), path.join(here, 'data'), { recursive: true });
