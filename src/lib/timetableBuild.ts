import { toMinutes, type OfficialDay, type Station } from './awqafFeed';
import { DEFAULT_SETTINGS, PRAYER_ORDER, computeDay, type PrayerKey } from './prayer';

/**
 * The checks that decide whether a month of Awqaf's published times may reach a
 * user. Shared by the daily server refresh (functions/refresh.ts) and the manual
 * `npm run build:timetable`, so both hold the feed to exactly the same bar.
 *
 * Nothing here trusts the feed. It has been caught serving a generic
 * fixed-90-minute-Isha filler part-way through a month for a single city,
 * carrying typo'd times on individual days, and publishing a whole month for one
 * city a steady minute or two early. A day or month that fails any check is
 * dropped, and the app computes it instead: a gap is recoverable, a wrong prayer
 * time is not.
 */

const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Dubai',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/**
 * How far a whole month may sit from the sun, on average, before it is held
 * back. Across Jan-Oct 2026 every city-month but one averaged under 0.9 min on
 * these prayers (the typical month is 0.06); the one that did not was Dubai in
 * October, 1.4-1.6 min early on Dhuhr, Maghrib and Isha, confirmed by a second
 * publisher. Asr gets more room because Awqaf's Asr drifts seasonally.
 */
export const BIAS_LIMIT: Record<PrayerKey, number> = {
  fajr: 1,
  sunrise: 1,
  dhuhr: 1,
  asr: 2,
  maghrib: 1,
  isha: 1,
};
/** A handful of days is too few for an average to mean anything. */
export const MIN_DAYS_FOR_BIAS = 5;

/** "month-day" -> minutes since midnight, one entry per prayer. */
export type Rows = Record<string, number[]>;

export interface Rejection {
  city: string;
  year: number;
  month: number;
  day: number;
  reason: string;
}

export interface HeldMonth {
  city: string;
  year: number;
  month: number;
  days: number;
  /** Average minutes the feed sits from the sun, per prayer (negative = early). */
  bias: Partial<Record<PrayerKey, number>>;
  reason: string;
}

export interface MonthOutcome {
  /** Days that passed every check; empty when the month is held. */
  rows: Rows;
  /** Set when the month as a whole was refused. */
  held: HeldMonth | null;
  rejections: Rejection[];
  /** How many days the feed offered. */
  seen: number;
}

type Deviation = Record<PrayerKey, number>;

/** Signed minutes the feed is from pure astronomy, per prayer. */
function deviationFromSun(station: Station, year: number, month: number, row: OfficialDay): Deviation {
  const settings = { ...DEFAULT_SETTINGS, method: 'Dubai' as const, elevation: station.elevation };
  // useOfficialTimetable=false: compare against the sun, never against a table.
  const computed = computeDay(
    station.latitude,
    station.longitude,
    new Date(year, month - 1, row.day, 12),
    settings,
    undefined,
    false,
  );
  const out = {} as Deviation;
  for (const key of PRAYER_ORDER) {
    out[key] = toMinutes(row[key]) - toMinutes(fmt.format(computed.times[key]));
  }
  return out;
}

/** Every check a single day must pass. Returns the reason it failed, or null. */
function dayFault(
  row: OfficialDay,
  deviation: Deviation,
  neighbours: { before?: OfficialDay; after?: OfficialDay },
): string | null {
  const minutes = PRAYER_ORDER.map((k) => toMinutes(row[k]));

  // 1. The day must run forwards.
  for (let i = 1; i < minutes.length; i += 1) {
    if (minutes[i] <= minutes[i - 1]) return `${PRAYER_ORDER[i]} is not after ${PRAYER_ORDER[i - 1]}`;
  }

  // 2. The generic filler pins Isha exactly 90 minutes after Maghrib.
  if (toMinutes(row.isha) - toMinutes(row.maghrib) === 90) return 'placeholder data (90-minute Isha)';

  // 3. Sanity against our own astronomy. A few minutes apart is expected and
  //    fine; a large gap means the feed handed us the wrong city or date.
  for (const key of PRAYER_ORDER) {
    const drift = Math.abs(deviation[key]);
    if (drift > 8) return `${key} is ${drift} min from the calculation`;
  }

  // 4. No day may jump away from its neighbours; the sun does not do that.
  const { before, after } = neighbours;
  if (before && after) {
    for (const key of PRAYER_ORDER) {
      const expected = (toMinutes(before[key]) + toMinutes(after[key])) / 2;
      if (Math.abs(toMinutes(row[key]) - expected) > 3) return `${key} jumps away from its neighbours`;
    }
  }

  return null;
}

/** Validate one city's month as fetched from the feed. */
export function evaluateMonth(
  station: Station,
  year: number,
  month: number,
  days: OfficialDay[],
): MonthOutcome {
  const rejections: Rejection[] = [];
  const accepted: { row: OfficialDay; deviation: Deviation }[] = [];

  for (let i = 0; i < days.length; i += 1) {
    const deviation = deviationFromSun(station, year, month, days[i]);
    const fault = dayFault(days[i], deviation, { before: days[i - 1], after: days[i + 1] });
    if (fault) {
      rejections.push({ city: station.city, year, month, day: days[i].day, reason: fault });
    } else {
      accepted.push({ row: days[i], deviation });
    }
  }

  // The month as a whole: a steady offset from the sun passes every per-day
  // check, so it is measured here instead.
  if (accepted.length >= MIN_DAYS_FOR_BIAS) {
    const bias: Partial<Record<PrayerKey, number>> = {};
    const breaches: string[] = [];
    for (const key of PRAYER_ORDER) {
      const mean = accepted.reduce((sum, d) => sum + d.deviation[key], 0) / accepted.length;
      bias[key] = Number(mean.toFixed(2));
      if (Math.abs(mean) > BIAS_LIMIT[key]) breaches.push(`${key} ${mean >= 0 ? '+' : ''}${mean.toFixed(2)}`);
    }
    if (breaches.length) {
      return {
        rows: {},
        held: {
          city: station.city,
          year,
          month,
          days: accepted.length,
          bias,
          reason: `feed sits a steady offset from the sun (${breaches.join(', ')} min)`,
        },
        rejections,
        seen: days.length,
      };
    }
  }

  const rows: Rows = {};
  for (const { row } of accepted) {
    rows[`${month}-${row.day}`] = PRAYER_ORDER.map((k) => toMinutes(row[k as PrayerKey]));
  }
  return { rows, held: null, rejections, seen: days.length };
}
