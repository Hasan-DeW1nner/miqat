import { useState, type ReactNode } from 'react';
import { Field, Sheet, selectClass } from './Sheet';
import { METHOD_BY_KEY, METHODS, methodForPlace, type MethodKey } from '../lib/methods';
import { PRAYER_META, PRAYER_ORDER } from '../lib/prayer';
import { useStore } from '../lib/store';
import { Segmented } from './Segmented';
import { CLOCK_STYLES } from './Countdown';
import { DIAL_STYLES, Dial } from './Dial';
import { ClockFormatPreview, IqamaPreview, LayoutPreview, OffsetPreview } from './SettingPreview';
import { NotifySetting } from './NotifySetting';
import { PrivacySetting } from './PrivacySetting';
import { OfflineSetting } from './OfflineSetting';
import { useI18n } from '../lib/i18n';
import type { ClockStyle } from './Countdown';
import type { DialStyle } from './Dial';

type Tab = 'display' | 'iqama' | 'calculation' | 'fine' | 'offline' | 'privacy';

const TABS: { id: Tab; label: string; labelAr: string }[] = [
  { id: 'display', label: 'Display', labelAr: 'العرض' },
  { id: 'iqama', label: 'Iqama', labelAr: 'الإقامة' },
  { id: 'calculation', label: 'Method', labelAr: 'الحساب' },
  { id: 'fine', label: 'Fine tune', labelAr: 'الضبط' },
  { id: 'offline', label: 'Offline', labelAr: 'دون اتصال' },
  { id: 'privacy', label: 'Privacy', labelAr: 'الخصوصية' },
];

const CLOCK_LABEL_AR: Record<ClockStyle, string> = {
  light: 'خفيف', serif: 'كلاسيكي', mono: 'أحادي', words: 'بالكلمات', target: 'وقت الصلاة',
};

const CLOCK_SAMPLE_AR: Record<ClockStyle, string> = {
  light: '1:28:33', serif: '1:28:33', mono: '1:28:33', words: '1 س 28 د', target: '04:39',
};

const DIAL_AR: Record<DialStyle, { label: string; hint: string }> = {
  arc: { label: 'قوس', hint: 'خط رفيع يكتمل تدريجيًا' },
  ticks: { label: 'علامات', hint: 'ستون علامة تضيء بالتتابع' },
  sweep: { label: 'عقرب', hint: 'عقرب متحرك مع الثواني' },
  orbit: { label: 'مدار', hint: 'نقطة تدور مع أثر خلفها' },
  chronograph: { label: 'كرونوغراف', hint: 'اثنا عشر جزءًا تمتلئ تدريجيًا' },
};

export function SettingsContent() {
  const {
    settings,
    patchSettings,
    setOffset,
    setIqamaOffset,
    resetOffsets,
    pinMethod,
    methodPinned,
    place,
  } = useStore();
  const { isArabic, text, methodLabel, methodSummary } = useI18n();
  const [tab, setTab] = useState<Tab>('display');
  const method = METHOD_BY_KEY.get(settings.method)!;
  const suggested = methodForPlace(place?.countryCode, place?.latitude, place?.longitude);
  const offsetsUsed = PRAYER_ORDER.some((k) => settings.offsets[k] !== 0);

  return (
    <div className="settings-content">
      <div className="mb-5">
        <span className="text-[13px] font-medium text-[var(--ink-dim)]">
          {text('Language', 'اللغة')}
        </span>
        <div className="mt-2">
          <Segmented
            label={text('App language', 'لغة التطبيق')}
            value={settings.language}
            onChange={(language) => patchSettings({ language })}
            options={[
              { value: 'en', label: 'English' },
              { value: 'ar', label: 'العربية' },
            ]}
          />
        </div>
      </div>
      <div className="-mt-1 mb-5">
        <Segmented
          label={text('Settings section', 'قسم الإعدادات')}
          value={tab}
          onChange={setTab}
          size="compact"
          fill={false}
          options={TABS.map((t) => ({ value: t.id, label: isArabic ? t.labelAr : t.label }))}
        />
      </div>

      <h2 className="settings-section-heading">{isArabic ? TABS.find((item) => item.id === tab)?.labelAr : TABS.find((item) => item.id === tab)?.label}</h2>
      {tab === 'display' && (
        <div className="space-y-6">
          <div>
            <span className="text-[13px] font-medium text-[var(--ink-dim)]">{text('Clock', 'الساعة')}</span>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(['24h', '12h'] as const).map((option) => (
                <button
                  key={option}
                  onClick={() => patchSettings({ timeFormat: option })}
                  className={`flex flex-col items-center gap-1 rounded-xl border py-3 transition ${
                    settings.timeFormat === option
                      ? 'border-[var(--accent-soft)] bg-white/10'
                      : 'border-[var(--card-line)] active:bg-white/5'
                  }`}
                >
                  <ClockFormatPreview format={option} language={settings.language} />
                  <span className="text-xs text-[var(--ink-dim)]">
                    {option === '24h' ? text('24-hour', 'نظام 24 ساعة') : text('12-hour', 'نظام 12 ساعة')}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="text-[13px] font-medium text-[var(--ink-dim)]">{text('Clock face', 'شكل الساعة')}</span>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {CLOCK_STYLES.map((option) => (
                <button
                  key={option.value}
                  onClick={() => patchSettings({ clockStyle: option.value })}
                  className={`rounded-xl border px-3 py-3 text-start transition ${
                    settings.clockStyle === option.value
                      ? 'border-[var(--accent-soft)] bg-white/10'
                      : 'border-[var(--card-line)] active:bg-white/5'
                  }`}
                >
                  <span className="block text-sm font-medium">{isArabic ? CLOCK_LABEL_AR[option.value] : option.label}</span>
                  <span
                    className={`tabular mt-1 block text-[var(--ink-dim)] clock-preview-${option.value}`}
                  >
                    {isArabic ? CLOCK_SAMPLE_AR[option.value] : option.sample}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="text-[13px] font-medium text-[var(--ink-dim)]">{text('Dial', 'مؤشر العد التنازلي')}</span>
            <p className="mt-1 text-xs text-[var(--ink-faint)]">
              {text('The ring around the countdown, and how it moves.', 'الحلقة المحيطة بالعد التنازلي وطريقة حركتها.')}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {DIAL_STYLES.map((option) => (
                <button
                  key={option.value}
                  onClick={() => patchSettings({ dialStyle: option.value })}
                  className={`rounded-xl border px-3 py-2.5 text-start transition ${
                    settings.dialStyle === option.value
                      ? 'border-[var(--accent-soft)] bg-white/10'
                      : 'border-[var(--card-line)] active:bg-white/5'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <span className="relative block h-11 w-11 shrink-0">
                      <Dial style={option.value} progress={0.68} seconds={0.42} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{isArabic ? DIAL_AR[option.value].label : option.label}</span>
                      <span className="mt-0.5 block text-[11px] leading-tight text-[var(--ink-faint)]">
                        {isArabic ? DIAL_AR[option.value].hint : option.hint}
                      </span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="text-[13px] font-medium text-[var(--ink-dim)]">{text('Prayer layout', 'تنسيق المواقيت')}</span>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {([
                { value: 'list', label: text('List', 'قائمة'), hint: text('Stacked rows, with notes', 'صفوف متتالية مع ملاحظات') },
                { value: 'grid', label: text('Grid', 'شبكة'), hint: text('Six tiles, three across', 'ست بطاقات، ثلاث في كل صف') },
              ] as const).map((option) => (
                <button
                  key={option.value}
                  onClick={() => patchSettings({ prayerLayout: option.value })}
                  className={`rounded-xl border px-3 py-2.5 text-start transition ${
                    settings.prayerLayout === option.value
                      ? 'border-[var(--accent-soft)] bg-white/10'
                      : 'border-[var(--card-line)] active:bg-white/5'
                  }`}
                >
                  <span className="flex flex-col items-center gap-2">
                    <LayoutPreview variant={option.value} />
                    <span className="text-sm font-medium">{option.label}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <NotifySetting />
          <Field label={text('Hijri adjustment', 'ضبط التاريخ الهجري')} hint={text('Days, for local moon sighting.', 'بالأيام، وفق رؤية الهلال المحلية.')}>
            <select
              className={selectClass}
              value={settings.hijriOffset}
              onChange={(e) => patchSettings({ hijriOffset: Number(e.target.value) })}
            >
              {[-2, -1, 0, 1, 2].map((d) => (
                <option key={d} value={d}>
                  {d > 0 ? `+${d}` : d} {isArabic ? 'يوم' : Math.abs(d) === 1 ? 'day' : 'days'}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}

      {tab === 'iqama' && (
        <div className="space-y-6">
          <p className="text-xs leading-relaxed text-[var(--ink-faint)]">
            {text(
              "Minutes from the adhan to the congregation. Awqaf's standard across the UAE is 20 minutes for Fajr, Dhuhr, Asr and Isha, and 5 for Maghrib — but mosques do vary, so set yours here. Switch the board between the two with the toggle at the top.",
              'عدد الدقائق بين الأذان والإقامة. معيار الأوقاف في الإمارات هو 20 دقيقة للفجر والظهر والعصر والعشاء، و5 دقائق للمغرب. قد تختلف المساجد، لذا اضبط مسجدك هنا، ثم بدّل بين الأذان والإقامة من أعلى صفحة المواقيت.',
            )}
          </p>
          <div className="space-y-1.5">
            {PRAYER_ORDER.filter((k) => k !== 'sunrise').map((key) => (
              <div key={key} className="rounded-xl border border-[var(--card-line)] px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{isArabic ? PRAYER_META[key].ar : PRAYER_META[key].en}</span>
                  <IqamaPreview minutes={settings.iqamaOffsets[key] ?? 0} language={settings.language} />
                </div>
                <div className="mt-1.5 flex items-center gap-3">
                  <input
                    type="range"
                    min={0}
                    max={45}
                    value={settings.iqamaOffsets[key] ?? 0}
                    onChange={(e) => setIqamaOffset(key, Number(e.target.value))}
                    className="flex-1"
                  />
                  <span className="tabular w-14 text-end text-sm text-[var(--ink-dim)]">
                    +{settings.iqamaOffsets[key] ?? 0} {text('m', 'د')}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <Field
            label={text('Jumuʿah', 'الجمعة')}
            hint={text('Friday replaces Dhuhr, and the time is fixed by the authority rather than by an offset. The UAE default is 12:45.', 'تحل صلاة الجمعة محل الظهر، وموعدها تحدده الجهة الرسمية بدلًا من إضافته كفارق زمني. الموعد الافتراضي في الإمارات هو 12:45.')}
          >
            <input
              type="time"
              className={selectClass}
              value={settings.jumuahTime}
              onChange={(e) => patchSettings({ jumuahTime: e.target.value })}
            />
          </Field>
        </div>
      )}

      {tab === 'calculation' && (
        <div className="space-y-6">
          <Field
            label={text('Method', 'طريقة الحساب')}
            hint={text(
              `${method.summary} — used in ${method.region}.${!methodPinned && place ? ` Auto-selected for ${place.country || place.countryCode}.` : ''}`,
              `${methodSummary(method.summary)} — الطريقة المستخدمة لهذا الموقع.${!methodPinned && place ? ` تم اختيارها تلقائيًا لـ ${place.countryCode === 'AE' ? 'الإمارات العربية المتحدة' : place.country || place.countryCode}.` : ''}`,
            )}
          >
            <select
              className={selectClass}
              value={settings.method}
              onChange={(e) => {
                patchSettings({ method: e.target.value as MethodKey });
                pinMethod(true);
              }}
            >
              {METHODS.map((m) => (
                <option key={m.key} value={m.key}>
                  {methodLabel(m.key, m.label)}
                </option>
              ))}
            </select>
          </Field>

          {methodPinned && place && suggested !== settings.method && (
            <button
              onClick={() => {
                patchSettings({ method: suggested });
                pinMethod(false);
              }}
              className="-mt-3 block text-xs text-[var(--accent)] underline underline-offset-4"
            >
              {text('Use the method normally followed in', 'استخدم الطريقة المتبعة عادةً في')} {place.country || place.countryCode} (
              {methodLabel(suggested, METHOD_BY_KEY.get(suggested)!.label)})
            </button>
          )}

          {settings.method === 'Custom' && (
            <div className="grid grid-cols-3 gap-3">
              <Field label={text('Fajr angle', 'زاوية الفجر')}>
                <input
                  type="number"
                  step="0.1"
                  className={selectClass}
                  value={settings.customFajrAngle}
                  onChange={(e) => patchSettings({ customFajrAngle: Number(e.target.value) })}
                />
              </Field>
              <Field label={text('Isha angle', 'زاوية العشاء')}>
                <input
                  type="number"
                  step="0.1"
                  className={selectClass}
                  value={settings.customIshaAngle}
                  onChange={(e) => patchSettings({ customIshaAngle: Number(e.target.value) })}
                />
              </Field>
              <Field label={text('Isha interval', 'فاصل العشاء')}>
                <input
                  type="number"
                  className={selectClass}
                  value={settings.customIshaInterval}
                  onChange={(e) => patchSettings({ customIshaInterval: Number(e.target.value) })}
                />
              </Field>
            </div>
          )}

          <ChoiceCards
            label={text('Asr — juristic school', 'العصر — المذهب الفقهي')}
            hint={
              settings.madhab === 'hanafi'
                ? text('Asr when a shadow is twice the object’s length.', 'يدخل العصر عندما يبلغ الظل مثلي طول الجسم.')
                : text('Asr when a shadow equals the object’s length.', 'يدخل العصر عندما يبلغ الظل طول الجسم.')
            }
            value={settings.madhab}
            options={[
              { value: 'shafi', label: text('Standard', 'المعيار المعتاد') },
              { value: 'hanafi', label: text('Hanafi', 'حنفي') },
            ]}
            onChange={(madhab) => patchSettings({ madhab })}
          />

          <Field
            label={text('High latitude rule', 'قاعدة خطوط العرض العليا')}
            hint={text('Only applies above roughly 48°, where twilight never fully ends in summer.', 'تُطبَّق تقريبًا فوق خط عرض 48°، حيث قد لا ينتهي الشفق تمامًا في الصيف.')}
          >
            <select
              className={selectClass}
              value={settings.highLatitudeRule}
              onChange={(e) =>
                patchSettings({
                  highLatitudeRule: e.target.value as typeof settings.highLatitudeRule,
                })
              }
            >
              <option value="auto">{text('Recommended for this location', 'الموصى بها لهذا الموقع')}</option>
              <option value="middleofthenight">{text('Middle of the night', 'منتصف الليل')}</option>
              <option value="seventhofthenight">{text('One seventh of the night', 'سُبع الليل')}</option>
              <option value="twilightangle">{text('Angle based', 'بحسب زاوية الشفق')}</option>
            </select>
          </Field>

          {settings.method === 'MoonsightingCommittee' && (
            <Field label={text('Shafaq (Isha twilight)', 'الشفق (وقت العشاء)')} hint={text('Only used by the Moonsighting Committee method.', 'يُستخدم فقط مع طريقة لجنة رؤية الهلال.')}>
              <select
                className={selectClass}
                value={settings.shafaq}
                onChange={(e) => patchSettings({ shafaq: e.target.value as typeof settings.shafaq })}
              >
                <option value="general">{text('General', 'عام')}</option>
                <option value="ahmer">{text('Ahmer — red twilight', 'الأحمر — الشفق الأحمر')}</option>
                <option value="abyad">{text('Abyad — white twilight', 'الأبيض — الشفق الأبيض')}</option>
              </select>
            </Field>
          )}
        </div>
      )}

      {tab === 'offline' && <OfflineSetting />}

      {tab === 'privacy' && <PrivacySetting />}

      {tab === 'fine' && (
        <div className="space-y-6">
          <div>
            <div className="flex items-baseline justify-between">
              <span className="text-[13px] font-medium text-[var(--ink-dim)]">
                {text('Manual correction', 'التصحيح اليدوي')}
              </span>
              {offsetsUsed && (
                <button
                  onClick={resetOffsets}
                  className="text-xs text-[var(--accent)] underline underline-offset-4"
                >
                  {text('Clear all', 'مسح الكل')}
                </button>
              )}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-[var(--ink-faint)]">
              {text(
                'If your mosque calls a few minutes off the calculation, nudge it here. This is the only way any app can match one specific mosque exactly.',
                'إذا كان أذان مسجدك يختلف بضع دقائق عن الحساب، فعدّل كل صلاة هنا. بهذه الطريقة يمكن مطابقة مسجد محدد بدقة.',
              )}
            </p>
            <div className="mt-3 space-y-1.5">
              {PRAYER_ORDER.map((key) => (
                <div key={key} className="flex items-center gap-3">
                  <span className="w-16 text-sm">{isArabic ? PRAYER_META[key].ar : PRAYER_META[key].en}</span>
                  <OffsetPreview minutes={settings.offsets[key]} />
                  <input
                    type="range"
                    min={-30}
                    max={30}
                    value={settings.offsets[key]}
                    onChange={(e) => setOffset(key, Number(e.target.value))}
                    className="flex-1"
                  />
                  <span className="tabular w-12 text-end text-sm text-[var(--ink-dim)]">
                    {settings.offsets[key] > 0 ? '+' : ''}
                    {settings.offsets[key]}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--card-line)] p-4">
            <label className="flex items-center justify-between gap-4">
              <span>
                <span className="block text-[13px] font-medium">{text('Use my full height', 'استخدم الارتفاع الكامل لموقعي')}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-[var(--ink-faint)]">
                  {text(
                    "Sunrise and Maghrib already allow for the terrain where your convention's authority accounts for it. Switch this on only if you are genuinely above the land around you — on a mountain rather than on a plateau — and it will use your full height above sea level instead.",
                    'تراعي مواقيت الشروق والمغرب تضاريس المنطقة عندما تعتمدها الجهة الرسمية. فعّل هذا الخيار فقط إذا كنت أعلى فعلًا من الأرض المحيطة، مثل وجودك على جبل، ليُستخدم ارتفاعك الكامل فوق سطح البحر.',
                  )}
                </span>
              </span>
              <input
                type="checkbox"
                checked={settings.useElevation}
                onChange={(e) => patchSettings({ useElevation: e.target.checked })}
                className="h-5 w-5 shrink-0 accent-[var(--accent)]"
              />
            </label>
            {settings.useElevation && (
              <div className="mt-4 flex items-center gap-3">
                <input
                  type="number"
                  min={0}
                  max={9000}
                  value={settings.elevation}
                  onChange={(e) => patchSettings({ elevation: Math.max(0, Number(e.target.value)) })}
                  className="w-28 rounded-xl border border-[var(--card-line)] bg-black/25 px-3 py-2 text-sm outline-none focus:border-[var(--accent-soft)]"
                />
                <span className="text-xs text-[var(--ink-dim)]">{text('metres above sea level', 'متر فوق سطح البحر')}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { text } = useI18n();
  return (
    <Sheet open={open} title={text('Settings', 'الإعدادات')} onClose={onClose}>
      <SettingsContent />
    </Sheet>
  );
}

function ChoiceCards<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: ReactNode;
  value: T;
  options: { value: T; label: string; example?: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div>
      <span className="text-[13px] font-medium text-[var(--ink-dim)]">{label}</span>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            onClick={() => onChange(option.value)}
            className={`rounded-xl border px-3 py-3 text-sm transition ${
              value === option.value
                ? 'border-[var(--accent-soft)] bg-white/10 text-[var(--ink)]'
                : 'border-[var(--card-line)] text-[var(--ink-dim)] active:bg-white/5'
            }`}
          >
            <span className="block font-medium">{option.label}</span>
            {option.example && (
              <span className="tabular mt-0.5 block text-xs text-[var(--ink-faint)]">
                {option.example}
              </span>
            )}
          </button>
        ))}
      </div>
      {hint && <p className="mt-1.5 text-xs leading-relaxed text-[var(--ink-faint)]">{hint}</p>}
    </div>
  );
}
