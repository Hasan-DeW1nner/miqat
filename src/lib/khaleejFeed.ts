import type { OfficialDay } from './awqafFeed';

/**
 * A second publisher of the Awqaf table, used only for Dubai and only when the
 * Gulf News month fails validation.
 *
 * Why Dubai only: Khaleej Times' other emirates are derived, not published (Abu
 * Dhabi is Dubai plus four minutes flat, Umm Al Quwain is Dubai exactly), so
 * they would replace real per-city figures with fake precision. Its Dubai table
 * is the real one: in August 2026 it matched Gulf News on every prayer of every
 * day, and in October 2026, when Gulf News served Ajman's table under Dubai's
 * name, it kept the usual Dubai-Sharjah offset and agreed with the astronomy.
 *
 * The page only ever shows the current month, which is fine for a job that runs
 * daily. It embeds the month as data, in 24-hour times; that is read rather than
 * the rendered table. Whatever comes back still goes through the same checks as
 * the Gulf News feed before it can reach anyone.
 */

const URLS: Record<string, string> = {
  Dubai: 'https://www.khaleejtimes.com/prayer-time-uae/dubai',
};

export const ALT_SOURCE = 'Khaleej Times';
export const hasAltSource = (city: string) => city in URLS;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const TIME = /^\d{2}:\d{2}$/;

/** The few entities the embedded state uses; enough to read it as JSON. */
function unescapeHtml(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** The JSON object that starts right after `marker`, by brace matching. */
function objectAfter(text: string, marker: string): unknown {
  const start = text.indexOf(marker);
  if (start === -1) return null;
  let i = start + marker.length;
  while (text[i] === ' ') i += 1;
  if (text[i] !== '{') return null;
  let depth = 0;
  let inString = false;
  for (let j = i; j < text.length; j += 1) {
    const ch = text[j];
    if (inString) {
      if (ch === '\\') j += 1;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(i, j + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * The month Khaleej Times is showing for `city`, if it is `month`. Returns an
 * empty list for any other city, any other month, or anything unreadable.
 */
export async function fetchAltMonth(
  city: string,
  month: number,
  signal?: AbortSignal,
): Promise<OfficialDay[]> {
  const url = URLS[city];
  if (!url) return [];

  const response = await fetch(url, {
    signal,
    headers: { accept: 'text/html', 'user-agent': 'miqat-accuracy-audit (+https://miqat-sepia.vercel.app)' },
  });
  if (!response.ok) return [];

  const data = objectAfter(unescapeHtml(await response.text()), '"prayerData":') as {
    month?: string;
    timings?: { day?: number; timings?: Record<string, string> }[];
  } | null;
  if (!data || data.month !== MONTH_NAMES[month - 1] || !Array.isArray(data.timings)) return [];

  const days: OfficialDay[] = [];
  for (const entry of data.timings) {
    const t = entry.timings ?? {};
    const keys = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;
    if (typeof entry.day !== 'number' || !keys.every((k) => TIME.test(t[k] ?? ''))) continue;
    days.push({
      day: entry.day,
      fajr: t.fajr,
      sunrise: t.sunrise,
      dhuhr: t.dhuhr,
      asr: t.asr,
      maghrib: t.maghrib,
      isha: t.isha,
    });
  }
  return days.sort((a, b) => a.day - b.day);
}
