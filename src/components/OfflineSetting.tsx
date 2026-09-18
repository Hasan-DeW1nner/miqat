import { useCallback, useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { useI18n } from '../lib/i18n';
import {
  OFFLINE_PAGES,
  dropOffline,
  keepOffline,
  offlineReady,
  offlineStatus,
  watchForNewBuild,
  type OfflinePage,
} from '../lib/offline';

const LABELS: Record<OfflinePage, { en: string; ar: string }> = {
  quran: { en: 'Qur’ān', ar: 'القرآن' },
  devotions: { en: 'Istighfār & dhikr', ar: 'الاستغفار والأذكار' },
  qibla: { en: 'Qibla compass', ar: 'بوصلة القبلة' },
  month: { en: 'Month view', ar: 'عرض الشهر' },
  settings: { en: 'Settings', ar: 'الإعدادات' },
};

function size(bytes: number, locale: string): string {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toLocaleString(locale, { maximumFractionDigits: 1 })} MB`;
  return `${Math.round(bytes / 1024).toLocaleString(locale)} KB`;
}

export function OfflineSetting() {
  const { text, locale } = useI18n();
  const offlinePages = useStore((state) => state.offlinePages);
  const setOfflinePage = useStore((state) => state.setOfflinePage);
  const [held, setHeld] = useState<Record<string, boolean>>({});
  const [bytes, setBytes] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<OfflinePage | null>(null);
  const [ready, setReady] = useState(() => offlineReady());
  const [failed, setFailed] = useState<OfflinePage | null>(null);

  const refresh = useCallback(async () => {
    if (!offlineReady()) {
      setReady(false);
      return;
    }
    setReady(true);
    const state = await offlineStatus();
    setHeld(state.pages);
    setBytes(state.bytes);
  }, []);

  useEffect(() => {
    void refresh();
    return watchForNewBuild(() => void refresh());
  }, [refresh]);

  const toggle = async (page: OfflinePage, wanted: boolean) => {
    setBusy(page);
    setFailed(null);
    // Record the intent first. If the download is cut off halfway the wish is
    // still on file, and it resumes on the next launch with a connection.
    setOfflinePage(page, wanted);
    const state = wanted
      ? await keepOffline([page])
      : await dropOffline([page], offlinePages.filter((id) => id !== page));
    setHeld(state.pages);
    if (state.bytes && Object.keys(state.bytes).length) setBytes(state.bytes);
    if (wanted && !state.pages[page]) setFailed(page);
    setBusy(null);
  };

  return (
    <div className="space-y-4">
      <div>
        <span className="block text-[13px] font-medium">{text('Keep on this device', 'الاحتفاظ على هذا الجهاز')}</span>
        <span className="mt-1 block text-xs leading-relaxed text-[var(--ink-faint)]">
          {text(
            'Prayer times, the countdown and the qibla arrow are worked out on your device and already open without a connection. Anything ticked below is downloaded too, so it opens on a walk or a flight. Whatever you leave unticked will not open offline.',
            'المواقيت والعدّ التنازلي وسهم القبلة تُحسب على جهازك وتعمل بلا اتصال أصلًا. ما تختاره أدناه يُنزَّل أيضًا ليفتح أثناء المشي أو في الطائرة. وما لا تختره لن يفتح دون اتصال.',
          )}
        </span>
      </div>

      {!ready && (
        <p className="rounded-2xl border border-[var(--card-line)] px-4 py-3 text-xs leading-relaxed text-[var(--ink-faint)]">
          {text(
            'Downloads become available a moment after the app is first opened online. Reload the page if this does not clear.',
            'يصبح التنزيل متاحًا بعد فتح التطبيق متصلًا بلحظات. أعد تحميل الصفحة إن لم تختفِ هذه الرسالة.',
          )}
        </p>
      )}

      <ul className="space-y-2">
        {OFFLINE_PAGES.map((page) => {
          const wanted = offlinePages.includes(page);
          const stored = held[page] === true;
          return (
            <li key={page} className="rounded-2xl border border-[var(--card-line)] px-4 py-3">
              <label className="flex items-center justify-between gap-4">
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium">{text(LABELS[page].en, LABELS[page].ar)}</span>
                  <span className="mt-0.5 block text-xs text-[var(--ink-faint)]">
                    {busy === page
                      ? text('Downloading…', 'جارٍ التنزيل…')
                      : failed === page
                        ? text('Download did not finish. Try again with a connection.', 'لم يكتمل التنزيل. أعد المحاولة مع وجود اتصال.')
                        : stored
                          ? text('On this device', 'محفوظ على الجهاز')
                          : size(bytes[page] ?? 0, locale) || text('Not downloaded', 'غير منزَّل')}
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={wanted}
                  disabled={!ready || busy !== null}
                  onChange={(event) => void toggle(page, event.target.checked)}
                  className="h-5 w-5 shrink-0 accent-[var(--accent)] disabled:opacity-40"
                  aria-label={text(`Keep ${LABELS[page].en} on this device`, `احفظ ${LABELS[page].ar} على الجهاز`)}
                />
              </label>
            </li>
          );
        })}
      </ul>

      <p className="text-xs leading-relaxed text-[var(--ink-faint)]">
        {text(
          'Recitation audio streams from the reciter’s server and still needs a connection. Your dhikr counts are saved on the device as you tap — they are never sent anywhere, so nothing is lost by being offline and nothing is overwritten when you reconnect.',
          'التلاوة الصوتية تُبَثّ من خادم القارئ وتحتاج اتصالًا. أما عدّاد الأذكار فيُحفظ على جهازك مع كل ضغطة، ولا يُرسل إلى أي مكان، فلا يضيع منه شيء دون اتصال ولا يُستبدل عند عودة الاتصال.',
        )}
      </p>
    </div>
  );
}
