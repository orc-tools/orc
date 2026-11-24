// Builds the scene kit and every bundled theme's scene against it.
//
// The kit is three.js plus the stage, party and factory engines and Swamp's
// own scene, built once into ui/vendor/theme-kit and served at
// /theme-kit/<apiVersion>/ (app-plugins/theme-surface.json lists what each
// module promises). A theme's scene bundle then holds only the theme's own
// code: its imports of three, ui/yeet and Swamp's scene become imports of
// those stable URLs, so every theme shares one copy of the engine, and an
// outside theme can import the same URLs without this repository.
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { build } = require('esbuild');
const nodePaths = (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean);

const root = path.dirname(fileURLToPath(import.meta.url));
const repo = path.dirname(root);
const surface = JSON.parse(await readFile(path.join(root, 'theme-surface.json'), 'utf8'));
const kitDir = path.join(repo, 'ui', 'vendor', 'theme-kit');
const kitUrl = '/theme-kit/' + surface.apiVersion + '/';
const kitSources = {
  three: path.join(repo, 'ui', 'yeet', 'three.js'),
  stage: path.join(repo, 'ui', 'yeet', 'stage.js'),
  party: path.join(repo, 'ui', 'yeet', 'party.js'),
  factory: path.join(repo, 'ui', 'yeet', 'factory.js'),
  'factory-layout': path.join(repo, 'ui', 'yeet', 'factory-layout.js'),
  swamp: path.join(root, 'swamp', 'scene.js'),
};
const promised = Object.keys(surface.sceneKit.modules).map(file => file.replace(/\.js$/, '')).sort();
if (JSON.stringify(promised) !== JSON.stringify(Object.keys(kitSources).sort())) {
  throw new Error('theme-surface.json sceneKit.modules must name exactly ' + Object.keys(kitSources).join(', '));
}
const common = { bundle: true, format: 'esm', minify: true, nodePaths, supported: { 'template-literal': false }, logLevel: 'warning' };

// A kit module, by the source file it is built from.
const kitBySource = new Map(Object.entries(kitSources).map(([name, source]) => [source, name + '.js']));

// Turns imports of three, ui/yeet and Swamp's scene into imports of kit
// modules at `base`, leaving `self` (the kit module being built) bundled.
function onKit(base, self = null) {
  return {
    name: 'theme-kit',
    setup(context) {
      context.onResolve({ filter: /^three(\/.*)?$/ }, args => {
        if (self === 'three.js') return null;
        if (args.path !== 'three') {
          if (self === 'stage.js') return null;
          throw new Error(args.importer + ': the scene kit offers three, not ' + args.path);
        }
        return { path: base + 'three.js', external: true };
      });
      context.onResolve({ filter: /^\.{1,2}\// }, args => {
        if (args.kind === 'entry-point') return null;
        const file = kitBySource.get(path.resolve(args.resolveDir, args.path));
        return file && file !== self ? { path: base + file, external: true } : null;
      });
    },
  };
}

// One file per kit module, each importing the others by relative URL, so the
// names stay put from one build to the next and every theme shares one copy.
await rm(kitDir, { recursive: true, force: true });
await Promise.all(Object.entries(kitSources).map(([name, source]) => build({
  ...common, entryPoints: [source], plugins: [onKit('./', name + '.js')], outfile: path.join(kitDir, name + '.js') })));

for (const dir of [root, path.join(repo, 'private')]) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') continue;
    throw error;
  }
  await Promise.all(entries.filter(entry => entry.isDirectory()).map(async entry => {
    const folder = path.join(dir, entry.name);
    let raw;
    try {
      raw = await readFile(path.join(folder, 'orc-plugin.json'), 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    const manifest = JSON.parse(raw);
    if (!manifest.build?.scene) return;
    const outfile = path.join(folder, manifest.contributes.theme.scene);
    const kitFile = kitBySource.get(path.join(folder, manifest.build.scene));
    const kitCopy = kitFile && kitUrl + kitFile;
    // Swamp's scene is in the kit already; its own bundle points there, so a
    // theme that builds on Swamp's scene shares the one copy.
    if (kitCopy) return writeFile(outfile, `export * from '${kitCopy}';\nexport { default } from '${kitCopy}';\n`);
    await build({ ...common, entryPoints: [path.join(folder, manifest.build.scene)], plugins: [onKit(kitUrl)],
      outfile });
  }));
}
