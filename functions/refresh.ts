import { STATIONS, fetchMonth, type Station } from '../src/lib/awqafFeed';
import { ALT_SOURCE, fetchAltMonth, hasAltSource } from '../src/lib/khaleejFeed';
import { evaluateMonth, type HeldMonth, type MonthOutcome, type Rows } from '../src/lib/timetableBuild';
import bundled from '../src/data/uae-timetable.json';
import { dbConfigured, loadStored, storeTimetable } from './serverDb';

export const config = { maxDuration: 60 };

/**
 * The daily refresh: pulls Awqaf's newly published days into the stored table so
 * users get them without anyone redeploying.
 *
 * It looks at every month from now to the end of next year that is not already
 * complete, so a new year's table is picked up the day it appears. Each month
 * goes through the same checks as the manual build. Where the Gulf News month
 * for Dubai fails them, the second publisher (src/lib/khaleejFeed.ts) is tried
 * for the current month, under the same checks.
 *
 * Merging follows one rule: it only ever ADDS. If the feed now disagrees with a
 * day that is already live, or has dropped one, that city-month is left exactly
 * as it was and the run says so. A feed that has been caught serving filler, and
 * another city's table, does not get to rewrite prayer times unattended.
 *
 * Safe to expose: it only runs when the last run is more than six hours old
 * (the cron secret overrides that), and it can only store what passes validation.
 */

const CRON_SECRET = process.env.CRON_SECRET ?? '';
const MIN_GAP_MS = 6 * 60 * 60 * 1000;
const CONCURRENCY = 10;
const FETCH_TIMEOUT_MS = 8000;
/** Stop starting new fetches after this, leaving time to merge and store. */
const FETCH_BUDGET_MS = 40000;

type Years = Record<string, Record<string, Rows>>;

interface AltSource {
  city: string;
  year: number;
  month: number;
  source: string;
}

interface Doc {
  source: string;
  url: string;
  timezone: string;
  built: string;
  order: string[];
  note: string;
  stations: unknown[];
  years: Years;
  held: HeldMonth[];
  sources?: AltSource[];
}

function uaeNow() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dubai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const year = get('year');
  const month = get('month');
  const day = get('day');
  return { year, month, iso: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
}

const daysIn = (year: number, month: number) => new Date(year, month, 0).getDate();
const monthKeys = (rows: Rows | undefined, month: number) =>
  Object.keys(rows ?? {}).filter((key) => key.startsWith(`${month}-`));
const countDays = (years: Years) =>
  Object.values(years).reduce(
    (sum, cities) => sum + Object.values(cities).reduce((n, rows) => n + Object.keys(rows).length, 0),
    0,
  );
const sameMonth = (a: { city: string; year: number; month: number }, city: string, year: number, month: number) =>
  a.city === city && a.year === year && a.month === month;

interface Task {
  station: Station;
  year: number;
  month: number;
}
interface Result extends Task {
  outcome: MonthOutcome;
  alt?: boolean;
}

async function refresh(stored: Awaited<ReturnType<typeof loadStored>>) {
  const started = Date.now();
  const now = uaeNow();

  // Start from whichever copy is newer: the stored one, or the one just deployed.
  const bundledDoc = bundled as unknown as Doc;
  const storedDoc = stored.doc as unknown as Doc | null;
  const base: Doc = JSON.parse(
    JSON.stringify(storedDoc?.years && storedDoc.built >= bundledDoc.built ? storedDoc : bundledDoc),
  );
  base.held = base.held ?? [];
  base.sources = base.sources ?? [];
  const before = countDays(base.years);

  // Every month from now to the end of next year that a city does not have in full.
  const tasks: Task[] = [];
  for (let year = now.year; year <= now.year + 1; year += 1) {
    for (let month = year === now.year ? now.month : 1; month <= 12; month += 1) {
      for (const station of STATIONS) {
        const have = monthKeys(base.years[String(year)]?.[station.city], month).length;
        if (have < daysIn(year, month)) tasks.push({ station, year, month });
      }
    }
  }

  let fetched = 0;
  let failed = 0;
  let skippedForTime = 0;
  const results: Result[] = [];
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const task = tasks[next++];
      if (Date.now() - started > FETCH_BUDGET_MS) {
        skippedForTime += 1;
        continue;
      }
      try {
        const month = await fetchMonth(task.station, task.year, task.month, AbortSignal.timeout(FETCH_TIMEOUT_MS));
        fetched += 1;
        if (month.days.length > 0) {
          results.push({ ...task, outcome: evaluateMonth(task.station, task.year, task.month, month.days) });
        }
      } catch {
        failed += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // The second publisher, for the current month only, where the main feed failed.
  for (const station of STATIONS.filter((s) => hasAltSource(s.city))) {
    const { year, month } = now;
    const complete = monthKeys(base.years[String(year)]?.[station.city], month).length >= daysIn(year, month);
    if (complete) continue;
    const main = results.find((r) => r.station.city === station.city && r.year === year && r.month === month);
    if (main && !main.outcome.held) continue;
    try {
      const days = await fetchAltMonth(station.city, month, AbortSignal.timeout(FETCH_TIMEOUT_MS));
      if (days.length < 20) continue;
      const outcome = evaluateMonth(station, year, month, days);
      if (outcome.held) continue;
      const alt: Result = { station, year, month, outcome, alt: true };
      if (main) results[results.indexOf(main)] = alt;
      else results.push(alt);
    } catch {
      /* the second publisher is a bonus; without it the month is calculated */
    }
  }

  let added = 0;
  let removedForHeld = 0;
  let changedDoc = false;
  const refused: string[] = [];

  for (const { station, year, month, outcome, alt } of results) {
    const label = `${station.city} ${year}-${String(month).padStart(2, '0')}`;
    const cityRows = base.years[String(year)]?.[station.city];
    const existingKeys = monthKeys(cityRows, month);
    const heldIndex = base.held.findIndex((h) => sameMonth(h, station.city, year, month));
    const fromAlt = base.sources.some((s) => sameMonth(s, station.city, year, month));

    if (outcome.held) {
      // The main feed looks wrong for this month. Days already taken from the
      // second publisher stay; anything else stops showing and is calculated.
      if (existingKeys.length && cityRows && !fromAlt) {
        existingKeys.forEach((key) => delete cityRows[key]);
        removedForHeld += existingKeys.length;
        changedDoc = true;
      }
      if (heldIndex === -1 && !fromAlt) {
        base.held.push(outcome.held);
        changedDoc = true;
      }
      continue;
    }

    let add = 0;
    let diff = 0;
    let drop = 0;
    for (const [key, value] of Object.entries(outcome.rows)) {
      const old = cityRows?.[key];
      if (!old) add += 1;
      else if (old.join() !== value.join()) diff += 1;
    }
    for (const key of existingKeys) if (!outcome.rows[key]) drop += 1;

    if (diff > 0 || drop > 0) {
      refused.push(`${label}: ${diff} changed, ${drop} dropped`);
      continue;
    }
    if (add > 0) {
      const yearRows = (base.years[String(year)] ??= {});
      Object.assign((yearRows[station.city] ??= {}), outcome.rows);
      if (heldIndex !== -1) base.held.splice(heldIndex, 1);
      if (alt && !fromAlt) base.sources.push({ city: station.city, year, month, source: ALT_SOURCE });
      added += add;
      changedDoc = true;
    }
  }

  // Years nobody has real data for are not carried, nor ones over a year old.
  for (const [year, cities] of Object.entries(base.years)) {
    const empty = Object.values(cities).every((rows) => Object.keys(rows).length === 0);
    if (empty || Number(year) < now.year - 1) delete base.years[year];
  }
  base.sources = base.sources.filter((s) => s.year >= now.year - 1);

  const after = countDays(base.years);
  // Belt and braces: a run may only shrink the table by days it deliberately held back.
  if (after < before - removedForHeld) {
    throw new Error(`refusing to store: table would shrink from ${before} to ${after} days`);
  }

  if (changedDoc) base.built = now.iso;

  const everyFetchFailed = fetched === 0 && failed > 0;
  const outcome = everyFetchFailed
    ? 'feed-unreachable'
    : changedDoc
      ? refused.length ? 'updated-with-refusals' : 'updated'
      : refused.length ? 'refused' : 'unchanged';

  const yearsCovered = Object.keys(base.years).sort();
  const meta = {
    checkedAt: new Date().toISOString(),
    outcome,
    added,
    heldMonths: base.held.map((h) => `${h.city} ${h.year}-${String(h.month).padStart(2, '0')}`),
    altSourced: base.sources.map((s) => `${s.city} ${s.year}-${String(s.month).padStart(2, '0')} (${s.source})`),
    refused,
    yearsCovered,
    monthsChecked: tasks.length,
    fetched,
    failed,
    skippedForTime,
    totalDays: after,
    built: base.built,
    ms: Date.now() - started,
  };

  await storeTimetable(changedDoc ? (base as unknown as Record<string, unknown>) : null, meta);
  return meta;
}

interface NodeRequest {
  headers: Record<string, string | string[] | undefined>;
}
interface NodeResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body: string): void;
}

export default async function handler(request: NodeRequest, response: NodeResponse): Promise<void> {
  const send = (body: unknown, status = 200) => {
    response.statusCode = status;
    response.setHeader('content-type', 'application/json');
    response.setHeader('cache-control', 'no-store');
    response.end(JSON.stringify(body, null, 2));
  };

  if (!dbConfigured()) {
    send({ error: 'refresh is not configured' }, 503);
    return;
  }

  const header = request.headers.authorization;
  const presented = Array.isArray(header) ? header[0] : header;
  const forced = CRON_SECRET.length > 0 && presented === `Bearer ${CRON_SECRET}`;

  let stored: Awaited<ReturnType<typeof loadStored>>;
  try {
    stored = await loadStored();
  } catch (error) {
    send({ error: (error as Error).message }, 502);
    return;
  }

  const last = typeof stored.meta?.checkedAt === 'string' ? Date.parse(stored.meta.checkedAt) : 0;
  if (!forced && last && Date.now() - last < MIN_GAP_MS) {
    send({ skipped: 'checked recently', last: stored.meta });
    return;
  }

  try {
    send(await refresh(stored));
  } catch (error) {
    const message = (error as Error).message;
    await storeTimetable(null, { checkedAt: new Date().toISOString(), outcome: 'error', error: message }).catch(() => {});
    send({ error: message }, 502);
  }
}
