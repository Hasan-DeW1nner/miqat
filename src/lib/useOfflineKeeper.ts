import { useEffect } from 'react';
import { useStore } from './store';
import { keepOffline, offlineStatus, watchForNewBuild, type OfflinePage } from './offline';

/**
 * Keeps the device's copy in step with what the reader asked for.
 *
 * Every deploy renames every chunk, which empties the page cache. Without this
 * a reader who downloaded the Qur'an in March would find it gone in April, and
 * only discover it on the train with no signal. So on launch, on reconnect and
 * whenever a new build takes over, anything still wanted but no longer held is
 * fetched again in the background.
 */
export function useOfflineKeeper() {
  const offlinePages = useStore((state) => state.offlinePages);

  useEffect(() => {
    if (offlinePages.length === 0) return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    let cancelled = false;

    const reconcile = async () => {
      if (cancelled || !navigator.onLine) return;
      await navigator.serviceWorker.ready.catch(() => undefined);
      if (cancelled || !navigator.serviceWorker.controller) return;
      const state = await offlineStatus();
      const missing = offlinePages.filter((page) => !state.pages[page]) as OfflinePage[];
      if (cancelled || missing.length === 0) return;
      await keepOffline(missing);
    };

    void reconcile();
    const onOnline = () => void reconcile();
    window.addEventListener('online', onOnline);
    const stopWatching = watchForNewBuild(() => void reconcile());
    return () => {
      cancelled = true;
      window.removeEventListener('online', onOnline);
      stopWatching();
    };
  }, [offlinePages]);
}
