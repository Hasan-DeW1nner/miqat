import { useState } from 'react';
import { Sky } from './Sky';
import { LocationSheet } from './LocationSheet';
import { locateMe } from '../lib/geo';
import { useStore } from '../lib/store';
import { PrivacySheet } from './PrivacySheet';
import { useI18n } from '../lib/i18n';

export function Onboarding({
  onOpenDevotions,
  onDevotionsIntent,
  onOpenQuran,
}: {
  onOpenDevotions: () => void;
  onDevotionsIntent: () => void;
  onOpenQuran: () => void;
}) {
  const { setPlace, settings, patchSettings } = useStore();
  const { language, text } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);

  const locate = async () => {
    setBusy(true);
    setError(null);
    try {
      setPlace(await locateMe(language));
    } catch (e) {
      const denied = (e as GeolocationPositionError).code === 1;
      setError(
        denied
          ? text('Location is blocked for this site. Search for your city instead — it is just as accurate.', 'الموقع محظور لهذا الموقع. ابحث عن مدينتك بدلًا من ذلك، فالنتيجة بالدقة نفسها.')
          : text('Could not get a fix. Search for your city instead.', 'تعذر تحديد الموقع. ابحث عن مدينتك بدلًا من ذلك.'),
      );
      setSearchOpen(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sky relative flex min-h-dvh items-center justify-center overflow-hidden px-6">
      <Sky latitude={25.2048} longitude={55.2708} />
      <button
        type="button"
        onClick={() => patchSettings({ language: settings.language === 'ar' ? 'en' : 'ar' })}
        className="absolute end-4 top-[max(1rem,env(safe-area-inset-top))] z-20 rounded-full border border-[var(--card-line)] bg-white/10 px-4 py-2 text-sm font-medium text-[var(--ink)] backdrop-blur-xl"
        aria-label={text('Switch language', 'تغيير اللغة')}
      >
        {settings.language === 'ar' ? 'English' : 'العربية'}
      </button>
      <div className="relative z-10 w-full max-w-sm text-center">
        <p className="arabic text-3xl text-[var(--accent)]">مواقيت الصلاة</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">{text('Miqāt', 'ميقات')}</h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--ink-dim)]">
          {text(
            'Prayer times worked out from the sun over your exact coordinates, matched to the timetable your mosque follows. No account, no ads, nothing tracked.',
            'مواقيت الصلاة محسوبة من موقع الشمس عند إحداثياتك الدقيقة، ومتوافقة مع الجدول الذي يتبعه مسجدك. بلا حساب، وبلا إعلانات، وبلا تتبع.',
          )}
        </p>

        <button
          onClick={locate}
          disabled={busy}
          className="mt-7 flex w-full items-center justify-center gap-2.5 rounded-2xl bg-[var(--accent)] px-5 py-3.5 text-sm font-semibold text-[var(--on-accent)] transition hover:brightness-110 disabled:opacity-70"
        >
          <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <circle cx="10" cy="10" r="2.8" fill="currentColor" />
            <circle cx="10" cy="10" r="6.4" stroke="currentColor" strokeWidth="1.6" />
            <path d="M10 1.2v2.3M10 16.5v2.3M1.2 10h2.3M16.5 10h2.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          {busy ? text('Finding you…', 'جارٍ تحديد موقعك…') : text('Use my location', 'استخدم موقعي')}
        </button>

        <button
          onClick={() => setSearchOpen(true)}
          className="mt-3 w-full rounded-2xl border border-[var(--card-line)] px-5 py-3 text-sm text-[var(--ink-dim)] transition hover:bg-white/5 hover:text-[var(--ink)]"
        >
          {text('Search for a city', 'ابحث عن مدينة')}
        </button>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onOpenDevotions}
            onPointerDown={onDevotionsIntent}
            onPointerEnter={onDevotionsIntent}
            onFocus={onDevotionsIntent}
            className="rounded-2xl border border-[var(--card-line)] px-3 py-3 text-sm font-medium text-[var(--ink-dim)] transition active:bg-white/8 active:text-[var(--ink)]"
          >
            {text('Istighfar', 'الاستغفار')}
          </button>
          <button
            type="button"
            onClick={onOpenQuran}
            className="rounded-2xl border border-[var(--card-line)] px-3 py-3 text-sm font-medium text-[var(--ink-dim)] transition active:bg-white/8 active:text-[var(--ink)]"
          >
            {text('Qur’an', 'القرآن')}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-[var(--ink-faint)]">
          {text('Both work without a location. To keep them for a walk with no signal, download them in Settings › Offline.', 'كلاهما يعمل دون تحديد موقع. وللاحتفاظ بهما أثناء المشي بلا تغطية، نزّلهما من الإعدادات ← دون اتصال.')}
        </p>

        {error && <p className="mt-4 text-sm leading-relaxed text-[var(--accent)]">{error}</p>}

        <p className="mt-8 text-xs leading-relaxed text-[var(--ink-faint)]">
          {text(
            "Your coordinates are used on this device to work out the times. The app also records an anonymous visit count and the town it resolved. Sharing your exact position with the app's owner is a separate switch in Settings, off unless you turn it on.",
            'تُستخدم إحداثياتك على هذا الجهاز لحساب المواقيت. يسجل التطبيق أيضًا عدد زيارات مجهولًا واسم المدينة التي حددها. مشاركة موقعك الدقيق مع مشغّل التطبيق خيار منفصل في الإعدادات، ويظل متوقفًا ما لم تفعّله.',
          )}{' '}
          <button
            onClick={() => setPolicyOpen(true)}
            className="text-[var(--ink-dim)] underline underline-offset-4"
          >
            {text('Privacy policy', 'سياسة الخصوصية')}
          </button>
        </p>
      </div>
      <LocationSheet open={searchOpen} onClose={() => setSearchOpen(false)} />
      <PrivacySheet open={policyOpen} onClose={() => setPolicyOpen(false)} />
    </div>
  );
}
