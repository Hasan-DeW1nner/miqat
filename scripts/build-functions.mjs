import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';

/**
 * Vercel transpiles a TypeScript route but does not follow its imports out of
 * api/, so a function that shares code with the app arrives on the server with
 * dangling module references. Bundling each one to a self-contained file first
 * keeps the engine in a single place instead of duplicating it into the route.
 */
await mkdir('api', { recursive: true });

for (const name of ['audit', 'refresh']) {
  await build({
    entryPoints: [`functions/${name}.ts`],
    outfile: `api/${name}.js`,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    minify: false,
    logLevel: 'info',
  });
}
