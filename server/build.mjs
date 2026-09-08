import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

// Bundles server + the @opentable/* workspace packages into one file. Those
// packages ship no compiled output of their own (their package.json `main`
// points at ./src/index.ts, for tsx in dev). Plain `node` cannot execute or
// resolve that, so bundling is what makes `node dist/index.js` possible at
// all. Real npm dependencies stay external and are resolved normally from
// node_modules at runtime. @opentable/preflop's two JSON files are static
// imports, so esbuild inlines their contents into this same bundle; nothing
// needs to be copied alongside dist/index.js for it to find them.
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
