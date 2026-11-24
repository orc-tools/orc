// Bundles @pierre/diffs for the Diff tab. Run through `pnpm run build:ui-vendor`.
//
// Code-split rather than a single file: the library loads grammars lazily,
// so each one becomes its own orc-diffs-<hash>.js chunk under ui/vendor/ and
// only the file types a diff actually contains are ever fetched. serve.py's
// /vendor/ route serves any flat .js basename, which is all a chunk needs.
//
// The `shiki` package is swapped for orc-diffs.shiki.js, which registers a
// curated grammar set instead of all 360, and `shiki/wasm` for an empty
// module so the Oniguruma blob is never emitted; `@shikijs/themes/*` likewise.
import { build } from 'esbuild';
import { readdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CHUNK = /^orc-diffs-[A-Z0-9]{8}\.js$/;

// stale chunks from a previous build would otherwise pile up next to the new ones
for (const name of readdirSync(here)) {
  if (CHUNK.test(name)) unlinkSync(join(here, name));
}

const shim = {
  name: 'orc-diffs-shiki-shim',
  setup(api) {
    api.onResolve({ filter: /^shiki$/ }, () => ({ path: join(here, 'orc-diffs.shiki.js') }));
    api.onResolve({ filter: /^shiki\/wasm$/ }, () => ({ path: 'shiki-wasm', namespace: 'orc-stub' }));
    // @pierre/theming registers every Shiki theme as a lazy import; the viewer
    // only uses the two Pierre themes it ships itself, so those 75 chunks are
    // stubbed out (one shared stub, so they cost one chunk rather than 75)
    api.onResolve({ filter: /^@shikijs\/themes\// }, () => ({ path: 'shiki-theme', namespace: 'orc-stub' }));
    api.onLoad({ filter: /.*/, namespace: 'orc-stub' }, () => ({ contents: 'export default undefined;', loader: 'js' }));
  },
};

await build({
  entryPoints: [join(here, 'orc-diffs.entry.js')],
  bundle: true,
  format: 'esm',
  minify: true,
  splitting: true,
  outdir: here,
  entryNames: 'orc-diffs.min',
  chunkNames: 'orc-diffs-[hash]',
  plugins: [shim],
  logLevel: 'info',
});

// Single-file module worker for off-thread Shiki tokenization and word-alt line
// diffing; passed directly as an entry point because @pierre/diffs's sideEffects
// list omits dist/worker/worker.js and would tree-shake a wrapper import.
await build({
  entryPoints: [fileURLToPath(import.meta.resolve('@pierre/diffs/worker/worker.js'))],
  bundle: true,
  format: 'esm',
  minify: true,
  splitting: false,
  outfile: join(here, 'orc-diffs-worker.min.js'),
  plugins: [shim],
  logLevel: 'info',
});
