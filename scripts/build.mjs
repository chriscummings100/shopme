import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const extensionBackground = {
  entryPoints: ['extension/src/background.ts'],
  bundle: true,
  outfile: 'extension/dist/background.js',
  format: 'iife',
  target: 'chrome120',
  sourcemap: true,
};

const extensionPopup = {
  entryPoints: ['extension/src/popup.ts'],
  bundle: true,
  outfile: 'extension/dist/popup.js',
  format: 'iife',
  target: 'chrome120',
  sourcemap: true,
};

const host = {
  entryPoints: ['host/src/index.ts'],
  bundle: true,
  outfile: 'host/dist/index.js',
  format: 'esm',
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  banner: {
    // Shim require() for CJS packages (e.g. ws) bundled into ESM output
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
};

const all = [extensionBackground, extensionPopup, host];

if (watch) {
  const contexts = await Promise.all(all.map(c => esbuild.context(c)));
  await Promise.all(contexts.map(ctx => ctx.watch()));
  console.log('Watching for changes...');
} else {
  await Promise.all(all.map(c => esbuild.build(c)));
  console.log('Build complete.');
}
