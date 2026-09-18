import { Component, Suspense, useEffect, useState, type ReactNode } from 'react';
import { useStore } from '../lib/store';
import { useI18n } from '../lib/i18n';
import { onlineNow, type OfflinePage } from '../lib/offline';

/**
 * Catches a page whose code will not load.
 *
 * A lazy chunk that is neither cached nor reachable rejects, and React unmounts
 * the whole tree for it. Without this the app would go blank on a train, which
 * is precisely when someone opened it.
 */
class ChunkBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function useOnline(): boolean {
  const [online, setOnline] = useState(onlineNow);
  useEffect(() => {
    const update = () => setOnline(onlineNow());
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

function NotDownloaded({ page }: { page: OfflinePage }) {
  const { text } = useI18n();
  const online = useOnline();
  return (
    <div className="grid min-h-[16rem] flex-1 place-items-center px-6 py-10 text-center">
      <div className="max-w-xs">
        <p className="text-[13px] font-medium">{text('Not available offline', 'غير متاح دون اتصال')}</p>
        <p className="mt-2 text-xs leading-relaxed text-[var(--ink-faint)]">
          {text(
            'This part was not downloaded to the device. Settings › Offline keeps it here for next time.',
            'لم يُنزَّل هذا القسم إلى الجهاز. من الإعدادات ← دون اتصال يمكنك الاحتفاظ به للمرة القادمة.',
          )}
        </p>
        <p className="mt-3 text-xs leading-relaxed text-[var(--ink-faint)]">
          {text('Prayer times and your dhikr counts are on the device and still work.', 'المواقيت وعدّاد الأذكار محفوظة على الجهاز وتعمل كالمعتاد.')}
        </p>
        {online && (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 rounded-full border border-[var(--card-line)] px-4 py-2 text-xs active:bg-white/10"
          >
            {text('Try again', 'أعد المحاولة')}
          </button>
        )}
        <span className="sr-only">{page}</span>
      </div>
    </div>
  );
}

/**
 * Renders a lazy page, or explains why it cannot be rendered.
 *
 * The check runs before the import is attempted, because a reader with no
 * signal should get a sentence rather than a spinner that never resolves.
 */
export function PageShell({ page, fallback, children }: {
  page: OfflinePage;
  fallback: ReactNode;
  children: ReactNode;
}) {
  const online = useOnline();
  const kept = useStore((state) => state.offlinePages).includes(page);
  if (!online && !kept) return <NotDownloaded page={page} />;
  return (
    <ChunkBoundary fallback={<NotDownloaded page={page} />}>
      <Suspense fallback={fallback}>{children}</Suspense>
    </ChunkBoundary>
  );
}
