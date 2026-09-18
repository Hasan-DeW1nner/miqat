/**
 * Keeping pages on the device.
 *
 * The service worker holds two caches: a shell that everyone gets, and a page
 * cache that only ever contains what the reader asked for. This module is the
 * conversation with it — ask what is kept, keep a page, let one go.
 *
 * Nothing here touches the counts. Dhikr totals live in localStorage and are
 * written on the device the moment they change, so they neither need the
 * network nor survive it: there is no server copy to disagree with.
 */

export const OFFLINE_PAGES = ['quran', 'devotions', 'qibla', 'month', 'settings'] as const;
export type OfflinePage = (typeof OFFLINE_PAGES)[number];

export interface OfflineState {
  /** True for a page whose every file is on the device. */
  pages: Record<string, boolean>;
  /** Download size per page, in bytes, as the build measured it. */
  bytes: Record<string, number>;
  version: string;
}

type Message = OfflineState & { type: 'miqat-offline-state' };

const EMPTY: OfflineState = { pages: {}, bytes: {}, version: '' };

/** Whether a worker is actually in charge of this page right now. */
export function offlineReady(): boolean {
  return typeof navigator !== 'undefined'
    && 'serviceWorker' in navigator
    && navigator.serviceWorker.controller !== null;
}

/**
 * Ask the worker something and wait for its reply on a private channel.
 *
 * A worker can be evicted between calls, so every request times out rather
 * than leaving a toggle spinning forever.
 */
function ask(message: Record<string, unknown>, timeoutMs = 60_000): Promise<OfflineState> {
  const worker = typeof navigator !== 'undefined' && 'serviceWorker' in navigator
    ? navigator.serviceWorker.controller
    : null;
  if (!worker) return Promise.resolve(EMPTY);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      resolve(EMPTY);
    }, timeoutMs);
    channel.port1.onmessage = (event: MessageEvent<Message>) => {
      clearTimeout(timer);
      channel.port1.close();
      const data = event.data;
      resolve(data && data.type === 'miqat-offline-state'
        ? { pages: data.pages ?? {}, bytes: data.bytes ?? {}, version: data.version ?? '' }
        : EMPTY);
    };
    worker.postMessage(message, [channel.port2]);
  });
}

export const offlineStatus = () => ask({ type: 'miqat-status' }, 8_000);
export const keepOffline = (pages: OfflinePage[]) => ask({ type: 'miqat-keep', pages });
export const dropOffline = (pages: OfflinePage[], keeping: OfflinePage[]) =>
  ask({ type: 'miqat-drop', pages, keeping }, 8_000);

/**
 * Run `onStale` when a new build lands, because the new build renames every
 * chunk and the pages the reader kept no longer match what is cached.
 */
export function watchForNewBuild(onStale: () => void): () => void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => undefined;
  const listener = (event: MessageEvent) => {
    if (event.data?.type === 'miqat-stale') onStale();
  };
  navigator.serviceWorker.addEventListener('message', listener);
  return () => navigator.serviceWorker.removeEventListener('message', listener);
}

/**
 * Whether the browser currently believes it has a connection.
 *
 * `navigator.onLine` is only ever trustworthy when it says false — a captive
 * hotel portal reports true. That is the right way round here: a false answer
 * makes the app explain itself instead of hanging on a fetch that cannot land.
 */
export function onlineNow(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}
