import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { STATIONS, fetchMonth } from '../src/lib/awqafFeed';
import { ALT_SOURCE, fetchAltMonth, hasAltSource } from '../src/lib/khaleejFeed';
import { PRAYER_ORDER } from '../src/lib/prayer';
import { evaluateMonth, type HeldMonth, type Rejection, type Rows } from '../src/lib/timetableBuild';

/**
 * Builds the bundled baseline copy of the official Awqaf timetable.
 *
 *   npm run build:timetable
 *
 * The live app does not depend on this: a daily server job (functions/refresh.ts)
 * keeps the up-to-date table in the database and the app fetches it. This
 * bundled copy is what a first visit, or an offline one, falls back on. Run it
 * before a deploy to keep that fallback fresh.
 *
 * Awqaf already accounts for the season, the convention and the rounding, so
 * where their table exists the app should simply show it rather than try to
 * re-derive it. This fetches it, refuses anything that fails the checks in
 * src/lib/timetableBuild.ts, and writes what survives into src/data. It covers
 * this year and next, and keeps last year's rows until they are a year old.
 */

const OUT = 'src/data/uae-timetable.json';

const THIS_YEAR = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', year: 'numeric' }).format(new Date()));
const THIS_MONTH = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', month: 'numeric' }).format(new Date()));
const YEARS = [THIS_YEAR, THIS_YEAR + 1];

async function main() {
  mkdirSync('src/data', { recursive: true });

  const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;

  const years: Record<string, Record<string, Rows>> = {};
  const held: HeldMonth[] = [];
  const sources: { city: string; year: number; month: number; source: string }[] = [];
  const rejections: Rejection[] = [];
  let kept = 0;
  let seen = 0;

  for (const year of YEARS) {
    const cities: Record<string, Rows> = {};

    for (const station of STATIONS) {
      cities[station.city] = {};

      for (let month = 1; month <= 12; month += 1) {
        const result = await fetchMonth(station, year, month).catch(() => null);
        let outcome = result && result.days.length ? evaluateMonth(station, year, month, result.days) : null;

        // Where the main feed fails for the current month, try the second
        // publisher (src/lib/khaleejFeed.ts) under the same checks.
        const current = year === THIS_YEAR && month === THIS_MONTH;
        if (current && hasAltSource(station.city) && (!outcome || outcome.held)) {
          const days = await fetchAltMonth(station.city, month).catch(() => []);
          const alt = days.length >= 20 ? evaluateMonth(station, year, month, days) : null;
          if (alt && !alt.held) {
            outcome = alt;
            sources.push({ city: station.city, year, month, source: ALT_SOURCE });
            console.log(`${station.city} ${year}-${month}: main feed failed the checks, using ${ALT_SOURCE}`);
          }
        }
        if (!outcome) continue;

        seen += outcome.seen;
        rejections.push(...outcome.rejections);
        if (outcome.held) {
          held.push(outcome.held);
          continue;
        }
        Object.assign(cities[station.city], outcome.rows);
        kept += Object.keys(outcome.rows).length;
      }

      const count = Object.keys(cities[station.city]).length;
      console.log(`${String(year)} ${station.city.padEnd(16)} ${String(count).padStart(3)} days accepted`);
    }

    // A year the feed has nothing real for is left out entirely, so the app
    // calculates it rather than carrying empty shells.
    if (Object.values(cities).some((rows) => Object.keys(rows).length > 0)) {
      years[String(year)] = cities;
    }
  }

  // Keep last year's rows so looking back across New Year still shows the
  // published times; they were validated when they were built.
  const lastYear = String(THIS_YEAR - 1);
  if (previous?.years?.[lastYear] && !years[lastYear]) years[lastYear] = previous.years[lastYear];

  const doc = {
    source: 'General Authority of Islamic Affairs and Endowments (Awqaf), as published by Gulf News',
    url: 'https://gulfnews.com/prayer-times',
    timezone: 'Asia/Dubai',
    built: new Date().toISOString().slice(0, 10),
    order: PRAYER_ORDER,
    note:
      'Minutes since midnight, keyed "month-day" under each year. Every day here passed validation; ' +
      'days and months the feed got wrong are absent on purpose and the app computes those.',
    stations: STATIONS.map((s) => ({
      city: s.city,
      latitude: s.latitude,
      longitude: s.longitude,
    })),
    years,
    held,
    sources,
  };

  writeFileSync(OUT, JSON.stringify(doc));
  const bytes = JSON.stringify(doc).length;

  console.log(`\n${kept} of ${seen} days accepted · ${rejections.length} rejected · ${held.length} city-months held · ${(bytes / 1024).toFixed(0)} kB raw`);
  if (held.length) {
    console.log('\nheld back (the app calculates these instead):');
    for (const h of held) console.log(`  ${h.city} ${h.year}-${String(h.month).padStart(2, '0')}: ${h.reason}`);
  }
  if (rejections.length) {
    console.log('\nrejected:');
    const grouped = new Map<string, number>();
    for (const r of rejections) {
      const key = `${r.city}: ${r.reason}`;
      grouped.set(key, (grouped.get(key) ?? 0) + 1);
    }
    for (const [key, n] of [...grouped].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${n.toString().padStart(3)}×  ${key}`);
    }
  }
}

main();
