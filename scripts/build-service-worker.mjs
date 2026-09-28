import { createHash } from 'node:crypto';
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('dist');
const manifest = JSON.parse(await readFile(path.join(root, '.vite', 'manifest.json'), 'utf8'));

/**
 * The shell is what has to exist before anything at all can open offline: the
 * document, the entry bundle, the stylesheet and the icons. `times` is not a
 * downloadable page because it *is* the shell — the board, the countdown and
 * the qibla arrow all live in the entry chunk.
 *
 * VerifySheet rides along because it opens from the times page, and a button
 * that does nothing offline is worse than the 11 KB it costs to keep.
 */
const SHELL_ENTRIES = ['index.html', 'src/components/VerifySheet.tsx'];
const SHELL_FILES = [
  '/index.html',
  '/manifest.webmanifest',
  '/favicon-32.png',
  '/miqat-gold-clock-192-20260928.png',
  '/apple-touch-icon.png',
];

/**
 * Pages a reader can choose to keep. Each value is the module the page is
 * reached through; everything it pulls in is worked out from the build graph
 * below, so a new import never silently goes missing from a download.
 */
const PAGE_ENTRIES = {
  qibla: ['src/components/QiblaPage.tsx'],
  quran: ['src/components/QuranPage.tsx'],
  month: ['src/components/MonthSheet.tsx'],
  settings: ['src/components/SettingsPage.tsx'],
  devotions: ['src/components/DevotionsPage.tsx'],
};

/**
 * Walk the build graph from a set of entries.
 *
 * Static imports are always followed. Dynamic imports are followed only away
 * from the entry document: the document dynamically imports every page, so
 * following them there would fold the whole app into the shell. From a page,
 * a dynamic import is part of that page — it is how the Qur'an text hangs off
 * the Qur'an screen.
 */
function closure(entries) {
  const seen = new Set();
  const files = new Set();
  const walk = (key) => {
    if (seen.has(key)) return;
    seen.add(key);
    const chunk = manifest[key];
    if (!chunk) throw new Error(`build graph has no chunk for ${key}`);
    files.add(`/${chunk.file}`);
    for (const asset of chunk.css ?? []) files.add(`/${asset}`);
    for (const asset of chunk.assets ?? []) files.add(`/${asset}`);
    for (const next of chunk.imports ?? []) walk(next);
    if (key !== 'index.html') for (const next of chunk.dynamicImports ?? []) walk(next);
  };
  for (const entry of entries) walk(entry);
  return files;
}

async function weigh(urls) {
  let total = 0;
  for (const url of urls) {
    try {
      total += (await stat(path.join(root, url.replace(/^\//, '')))).size;
    } catch {
      // A URL with no file on disk is a route, not an asset, and costs nothing.
    }
  }
  return total;
}

const shell = new Set([...SHELL_FILES, ...closure(SHELL_ENTRIES)]);
const pages = {};
const bytes = {};
for (const [id, entries] of Object.entries(PAGE_ENTRIES)) {
  // Subtract the shell: it is already on the device, so a download should not
  // claim credit for it or re-fetch it.
  const own = [...closure(entries)].filter((url) => !shell.has(url)).sort();
  pages[id] = own;
  bytes[id] = await weigh(own);
}

const digest = createHash('sha256');
for (const url of [...shell, ...Object.values(pages).flat()].sort()) {
  digest.update(url);
  try {
    digest.update(await readFile(path.join(root, url.replace(/^\//, ''))));
  } catch {
    digest.update('route');
  }
}
const version = digest.digest('hex').slice(0, 16);
const shellUrls = ['/', ...[...shell].sort()];

const source = `const VERSION = '${version}';
const SHELL_CACHE = 'miqat-shell-' + VERSION;
const PAGE_CACHE = 'miqat-pages-' + VERSION;

const SHELL_URLS = ${JSON.stringify(shellUrls, null, 2)};
const PAGE_ASSETS = ${JSON.stringify(pages, null, 2)};
const PAGE_BYTES = ${JSON.stringify(bytes, null, 2)};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => /^miqat-(shell|pages|offline)-/.test(key) && key !== SHELL_CACHE && key !== PAGE_CACHE)
        .map((key) => caches.delete(key)),
    );
    await self.clients.claim();
    // A new build renames every chunk, so whatever was downloaded no longer
    // matches. Tell the open tabs to fetch their kept pages again.
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const client of clients) client.postMessage({ type: 'miqat-stale', version: VERSION });
  })());
});

const isShell = (url) => SHELL_URLS.includes(url.pathname) || url.pathname === '/index.html';

/*
 * ignoreVary matters more than it looks.
 *
 * A static host answers with \`Vary: Origin\`, and \`cache.addAll\` stores a
 * request that carries no Origin header, while the browser's own request for a
 * module script does. Matched strictly, a chunk that is sitting in the cache
 * reads as a miss, and the page then fails on a train with the file already on
 * the device. These are content-hashed files; the origin cannot change what
 * they contain.
 */
const MATCH = { ignoreVary: true };

async function fromCaches(request) {
  const pageCache = await caches.open(PAGE_CACHE);
  const stored = await pageCache.match(request, MATCH);
  if (stored) return stored;
  const shellCache = await caches.open(SHELL_CACHE);
  return shellCache.match(request, MATCH);
}

async function asset(request) {
  const cached = await fromCaches(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    // Only the shell fills itself in from the network. A page the reader did
    // not download must not become available offline by accident, because the
    // list in settings would then be telling them something untrue.
    if (response.ok && isShell(new URL(request.url))) {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return new Response('', { status: 504, statusText: 'Offline and not downloaded' });
  }
}

async function navigation(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put('/index.html', response.clone());
    }
    return response;
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    return (await cache.match('/index.html', MATCH)) || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  event.respondWith(request.mode === 'navigate' ? navigation(request) : asset(request));
});

async function downloaded() {
  const cache = await caches.open(PAGE_CACHE);
  const held = new Set((await cache.keys()).map((request) => new URL(request.url).pathname));
  const state = {};
  for (const id of Object.keys(PAGE_ASSETS)) {
    state[id] = PAGE_ASSETS[id].length > 0 && PAGE_ASSETS[id].every((url) => held.has(url));
  }
  return state;
}

async function report(target, port) {
  const message = { type: 'miqat-offline-state', version: VERSION, pages: await downloaded(), bytes: PAGE_BYTES };
  if (port) port.postMessage(message);
  else if (target) target.postMessage(message);
}

async function keep(ids) {
  const cache = await caches.open(PAGE_CACHE);
  for (const id of ids) {
    const urls = PAGE_ASSETS[id];
    if (!urls) continue;
    // addAll is all-or-nothing, which is what a download should be: a page is
    // either wholly on the device or not claimed as kept.
    await cache.addAll(urls);
  }
}

async function drop(ids, stillKept) {
  const cache = await caches.open(PAGE_CACHE);
  const spare = new Set();
  for (const id of stillKept) for (const url of PAGE_ASSETS[id] ?? []) spare.add(url);
  for (const id of ids) {
    for (const url of PAGE_ASSETS[id] ?? []) {
      // Chunks are shared between pages, so only let go of what nothing else
      // still needs.
      if (spare.has(url) || SHELL_URLS.includes(url)) continue;
      await cache.delete(url, MATCH);
    }
  }
}

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  const port = event.ports && event.ports[0];
  const source = event.source;
  if (data.type === 'miqat-status') {
    event.waitUntil(report(source, port));
    return;
  }
  if (data.type === 'miqat-keep') {
    event.waitUntil(
      keep(data.pages || [])
        .catch(() => undefined)
        .then(() => report(source, port)),
    );
    return;
  }
  if (data.type === 'miqat-drop') {
    event.waitUntil(
      drop(data.pages || [], data.keeping || [])
        .catch(() => undefined)
        .then(() => report(source, port)),
    );
  }
});
`;

await writeFile(path.join(root, 'sw.js'), source);
// The manifest is a build input, not something to publish: it lists the source
// path behind every chunk.
await rm(path.join(root, '.vite'), { recursive: true, force: true });
const kb = (n) => `${Math.round(n / 1024)} KB`;
console.log(`sw.js ${version}: shell ${kb(await weigh([...shell]))}`);
for (const [id, urls] of Object.entries(pages)) console.log(`  ${id.padEnd(10)} ${urls.length} files  ${kb(bytes[id])}`);
