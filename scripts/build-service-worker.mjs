import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('dist');
const files = [];

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collect(absolute);
      continue;
    }
    if (entry.name === 'sw.js') continue;
    const relative = `/${path.relative(root, absolute).split(path.sep).join('/')}`;
    files.push({ absolute, relative });
  }
}

await collect(root);

const digest = createHash('sha256');
for (const file of files) {
  digest.update(file.relative);
  digest.update(await readFile(file.absolute));
}
const version = digest.digest('hex').slice(0, 16);
const essentialFiles = files.filter(({ relative }) =>
  relative === '/index.html' ||
  relative === '/manifest.webmanifest' ||
  /^\/(?:apple-touch-icon(?:-[^/]+)?\.png|favicon-32\.png|icon(?:-\d+)?\.(?:png|svg))$/.test(relative) ||
  /^\/assets\/(?:index-|DevotionsPage-|QuranPage-|quran-)/.test(relative),
);
const urls = ['/', ...essentialFiles.map((file) => file.relative), '/sw.js'];

const source = `const CACHE_NAME = 'miqat-offline-${version}';
const PRECACHE_URLS = ${JSON.stringify([...new Set(urls)], null, 2)};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('miqat-offline-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

async function cachedAsset(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function navigation(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put('/index.html', response.clone());
    }
    return response;
  } catch {
    return (await caches.match('/index.html')) || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  event.respondWith(request.mode === 'navigate' ? navigation(request) : cachedAsset(request));
});
`;

await writeFile(path.join(root, 'sw.js'), source);
console.log(`Generated dist/sw.js with ${essentialFiles.length} essential precached assets (${version})`);
