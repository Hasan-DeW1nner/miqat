import table from '../data/uae-timetable.json';
import type { PrayerKey } from './prayer';

/**
 * The published Awqaf timetable, shipped with the app.
 *
 * Where this has an answer, the app shows it rather than calculating. Awqaf has
 * already decided the angle, the rounding, the terrain and every seasonal
 * subtlety; re-deriving all of that only creates opportunities to differ from
 * the mosque. Calculation remains the fallback — for towns without a published
 * table, for dates beyond it, and for the rest of the world.
 *
 * Every day in here passed validation (src/lib/timetableBuild.ts). Days the feed
 * got wrong are simply absent, and those fall through to the calculation: a gap
 * is recoverable, a wrong prayer time is not.
 *
 * Two copies exist. The one bundled with the app (`npm run build:timetable`) is
 * the floor that works on a first or offline visit. A daily server job keeps a
 * fresher copy in the database, served from /api/timetable; once the app has it,
 * that copy is used instead, so new months reach users without a redeploy.
 */

/** The UAE keeps UTC+4 all year, so a wall-clock time is one instant. */
const UTC_OFFSET_HOURS = 4;
/** Beyond this from a published city, its table does not describe your sky. */
const MAX_DISTANCE_KM = 40;

const ORDER = table.order as PrayerKey[];

/** year -> city -> "month-day" -> minutes since midnight, one entry per prayer. */
type Years = Record<string, Record<string, Record<string, number[]>>>;
const BUNDLED_YEARS: Years = (table as unknown as { years?: Years }).years ?? {};
const BUNDLED_BUILT: string = (table as unknown as { built?: string }).built ?? '';

interface HeldMonth {
  city: string;
  year: number;
  month: number;
  reason: string;
}
/** A city-month taken from a second publisher because the main feed failed. */
interface AltSource {
  city: string;
  year: number;
  month: number;
  source: string;
}
export interface TimetableDoc {
  built: string;
  order: string[];
  years: Years;
  held?: HeldMonth[];
  sources?: AltSource[];
}

/** The fresher copy fetched from the server, once the app has one. */
let runtime: TimetableDoc | null = null;
let version = 0;
const listeners = new Set<() => void>();
const CACHE_KEY = 'miqat.timetable.v1';

/** Never trust a document just because it arrived: check its shape. */
function isTimetableDoc(doc: unknown): doc is TimetableDoc {
  if (!doc || typeof doc !== 'object') return false;
  const d = doc as Partial<TimetableDoc>;
  if (typeof d.built !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.built)) return false;
  if (!Array.isArray(d.order) || d.order.join() !== ORDER.join()) return false;
  if (!d.years || typeof d.years !== 'object') return false;
  let days = 0;
  for (const cities of Object.values(d.years)) {
    for (const rows of Object.values(cities ?? {})) {
      for (const [key, minutes] of Object.entries(rows ?? {})) {
        days += 1;
        if (!/^\d{1,2}-\d{1,2}$/.test(key)) return false;
        if (!Array.isArray(minutes) || minutes.length !== ORDER.length) return false;
        if (!minutes.every((m) => Number.isInteger(m) && m >= 0 && m < 1440)) return false;
      }
    }
  }
  return days < 20000;
}

/**
 * Use a fresher table than the bundled one. Ignored if it is malformed or older
 * than what shipped, so a stale cache can never hide newer bundled data.
 */
export function setRuntimeTimetable(doc: unknown): boolean {
  if (!isTimetableDoc(doc)) return false;
  if (doc.built < BUNDLED_BUILT) return false;
  if (runtime && doc.built < runtime.built) return false;
  runtime = doc;
  version += 1;
  listeners.forEach((listener) => listener());
  return true;
}

export const timetableVersion = () => version;
export function subscribeTimetable(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Which table is in force: the fetched one if there is one, else the bundled one. */
export function currentTimetable(): { built: string; years: Years; held: HeldMonth[]; sources: AltSource[] } {
  const doc = runtime ?? (table as unknown as TimetableDoc);
  return {
    built: runtime ? runtime.built : BUNDLED_BUILT,
    years: runtime ? runtime.years : BUNDLED_YEARS,
    held: doc.held ?? [],
    sources: doc.sources ?? [],
  };
}

/**
 * Pick up the server's table: the last good copy from this device first, so it
 * works offline and instantly, then the network. Every failure is silent; the
 * bundled table is always there underneath.
 */
export async function loadRuntimeTimetable(): Promise<void> {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) setRuntimeTimetable(JSON.parse(cached));
  } catch {
    /* storage can be blocked or empty */
  }
  try {
    const response = await fetch('/api/timetable');
    if (!response.ok || response.status === 204) return;
    const doc: unknown = await response.json();
    if (setRuntimeTimetable(doc)) {
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(doc));
      } catch {
        /* over quota or blocked: fine, it just will not be cached */
      }
    }
  } catch {
    /* offline or the function is down */
  }
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function publishedCityFor(latitude: number, longitude: number): string | null {
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const station of table.stations) {
    const distance = distanceKm(latitude, longitude, station.latitude, station.longitude);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = station.city;
    }
  }
  return bestDistance <= MAX_DISTANCE_KM ? best : null;
}

export interface OfficialDay {
  city: string;
  times: Record<PrayerKey, Date>;
}

/**
 * The published times for this place and date, or null when the table does not
 * cover it. `date` is read as a civil date in the UAE.
 */
export function officialTimes(
  latitude: number,
  longitude: number,
  date: Date,
): OfficialDay | null {
  const city = publishedCityFor(latitude, longitude);
  if (!city) return null;

  const year = date.getFullYear();
  // A fetched table is authoritative for every year it carries; a year it does
  // not carry falls back to the bundled one.
  const years = runtime && runtime.years[String(year)] ? runtime.years : BUNDLED_YEARS;
  const rows = years[String(year)]?.[city];
  const minutes = rows?.[`${date.getMonth() + 1}-${date.getDate()}`];
  if (!minutes || minutes.length !== ORDER.length) return null;

  const times = {} as Record<PrayerKey, Date>;
  ORDER.forEach((key, index) => {
    const value = minutes[index];
    times[key] = new Date(
      Date.UTC(year, date.getMonth(), date.getDate(), Math.floor(value / 60) - UTC_OFFSET_HOURS, value % 60),
    );
  });

  return { city, times };
}

export const TIMETABLE_SOURCE = table.source;
export const TIMETABLE_YEARS = Object.keys(BUNDLED_YEARS).map(Number);
