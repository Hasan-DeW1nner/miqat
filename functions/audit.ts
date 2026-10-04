import { FEED_SOURCE, STATIONS, fetchMonth, toMinutes } from '../src/lib/awqafFeed';
import { DEFAULT_SETTINGS, PRAYER_ORDER, computeDay, type PrayerKey } from '../src/lib/prayer';
import { currentTimetable, setRuntimeTimetable } from '../src/lib/officialTimetable';
import { loadStored } from './serverDb';

export const config = { maxDuration: 60 };

/**
 * The standing accuracy watch.
 *
 * Once a day this recomputes the whole current month for all eight stations
 * Awqaf publishes and diffs it against the published table, so a drift is
 * caught by a machine on the day it appears rather than by someone noticing
 * their sunrise looks wrong. Cron hits it with the secret; anyone may read the
 * last result, which is only a set of accuracy statistics.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVER_SECRET = process.env.MIQAT_SERVER_SECRET ?? '';
const CRON_SECRET = process.env.CRON_SECRET ?? '';
const ALERT_WEBHOOK = process.env.ALERT_WEBHOOK_URL ?? '';

interface HeldMonth {
  city: string;
  year: number;
  month: number;
  reason: string;
}
/** The table users actually get: the stored one once loaded, else the bundled one. */
const shipped = () => currentTimetable().years;
/** City-months the build refused to ship because the feed sat off the sun. */
const held = (): HeldMonth[] => currentTimetable().held;
const isHeld = (city: string, year: number, month: number) =>
  held().some((h) => h.city === city && h.year === year && h.month === month);

/** Matches the bar `npm run verify` holds the engine to. */
const TOLERANCE_MINUTES = 3;
const REQUIRED_WITHIN_ONE_MINUTE = 0.99;

async function rpc(name: string, body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${name} returned ${response.status}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

/**
 * Fires only on a failed audit. Shaped so a Slack or Discord incoming webhook
 * renders it as-is, and any other endpoint still gets the full JSON.
 */
async function alert(summary: Awaited<ReturnType<typeof runAudit>>): Promise<string | null> {
  if (!ALERT_WEBHOOK) return 'no webhook configured';
  const worst = summary.worstStation
    ? `${summary.worstStation} ${summary.worstPrayer} is ${summary.worstDelta} min out`
    : 'no stations could be read';
  const text =
    `Miqāt accuracy alert — prayer times no longer match the published Awqaf table.\n` +
    `${worst}. ${(summary.withinOneMinute * 100).toFixed(1)}% of ${summary.comparisons} ` +
    `checks were within a minute (needs ${REQUIRED_WITHIN_ONE_MINUTE * 100}%).\n` +
    `https://miqat-sepia.vercel.app/api/audit`;
  try {
    const response = await fetch(ALERT_WEBHOOK, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, content: text, summary }),
    });
    return response.ok ? 'sent' : `webhook returned ${response.status}`;
  } catch (error) {
    return `webhook failed: ${(error as Error).message}`;
  }
}

interface StationReport {
  city: string;
  days: number;
  worst: number;
  withinOneMinute: number;
}

/**
 * Has Awqaf published dates the shipped table does not carry yet?
 *
 * This is the signal that matters now: the app shows their table where it has
 * one, so the job is no longer to detect drift but to notice when there is more
 * table to fetch. It reports; it never rewrites what users see on its own. A
 * feed that has been caught serving filler does not get to update prayer times
 * unattended.
 */
async function coverage(year: number, month: number) {
  let have = 0;
  let fresh = 0;
  const months = new Set<string>();

  for (const station of STATIONS) {
    have += Object.keys(shipped()[String(year)]?.[station.city] ?? {}).length;

    // This month and the next three, across New Year, so a rollover is seen
    // coming rather than discovered on the day.
    for (let step = 0; step < 4; step += 1) {
      const y = year + Math.floor((month - 1 + step) / 12);
      const m = ((month - 1 + step) % 12) + 1;
      // A held month is not news: the feed has it, the build refused it.
      if (isHeld(station.city, y, m)) continue;

      const rows = shipped()[String(y)]?.[station.city] ?? {};
      const known = Object.keys(rows).filter((k) => k.startsWith(`${m}-`)).length;
      // Only look where the shipped table is thin; a full month needs no check.
      if (known >= 28) continue;
      const result = await fetchMonth(station, y, m).catch(() => null);
      if (!result) continue;
      const extra = result.days.filter((d) => !rows[`${m}-${d.day}`]).length;
      if (extra > 0) {
        fresh += extra;
        months.add(`${y}-${String(m).padStart(2, '0')}`);
      }
    }
  }

  return { shippedDays: have, newDays: fresh, newMonths: [...months].sort() };
}

async function runAudit() {
  const now = new Date();
  // Anchor on the UAE calendar, not the server's.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dubai',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);

  const format = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dubai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const notes: string[] = [];
  const reports: StationReport[] = [];
  let comparisons = 0;
  let within = 0;
  let worstDelta = 0;
  let worstStation: string | null = null;
  let worstPrayer: string | null = null;
  let worstDay: number | null = null;

  const months = await Promise.all(
    STATIONS.map((station) =>
      fetchMonth(station, year, month).catch((error: Error) => ({
        station,
        days: [],
        notes: [`${station.city}: ${error.message}`],
      })),
    ),
  );

  for (const result of months) {
    notes.push(...result.notes);
    if (result.days.length === 0) continue;

    // The build held this month back because the feed itself looks wrong, so
    // the app calculates it and a disagreement with the feed is expected. Say
    // so, but do not fail the watch over the feed's own fault.
    const heldMonth = held().find((h) => h.city === result.station.city && h.year === year && h.month === month);
    if (heldMonth) {
      notes.push(`${heldMonth.city} ${year}-${String(month).padStart(2, '0')} is held back (${heldMonth.reason}); the app calculates it`);
      continue;
    }
    // Likewise a month taken from the second publisher because this feed failed
    // for it: comparing against the feed would only re-report the feed's fault.
    const alt = currentTimetable().sources.find(
      (s) => s.city === result.station.city && s.year === year && s.month === month,
    );
    if (alt) {
      notes.push(`${alt.city} ${year}-${String(month).padStart(2, '0')} uses ${alt.source}; the Gulf News month failed validation`);
      continue;
    }

    const settings = {
      ...DEFAULT_SETTINGS,
      method: 'Dubai' as const,
      elevation: result.station.elevation,
    };
    let stationWorst = 0;
    let stationWithin = 0;
    let stationChecks = 0;

    for (const row of result.days) {
      const day = computeDay(
        result.station.latitude,
        result.station.longitude,
        new Date(year, month - 1, row.day, 12),
        settings,
      );
      for (const key of PRAYER_ORDER) {
        const delta =
          toMinutes(format.format(day.times[key])) - toMinutes(row[key as PrayerKey]);
        const size = Math.abs(delta);
        stationChecks += 1;
        comparisons += 1;
        if (size <= 1) {
          stationWithin += 1;
          within += 1;
        }
        if (size > stationWorst) stationWorst = size;
        if (size > worstDelta) {
          worstDelta = size;
          worstStation = result.station.city;
          worstPrayer = key;
          worstDay = row.day;
        }
      }
    }

    reports.push({
      city: result.station.city,
      days: result.days.length,
      worst: stationWorst,
      withinOneMinute: stationChecks ? stationWithin / stationChecks : 0,
    });
  }

  const published = await coverage(year, month);
  if (published.newDays > 0) {
    notes.push(
      `Awqaf has published ${published.newDays} day(s) the stored timetable does not carry yet ` +
        `(${published.newMonths.join(', ')}). ` +
        `The daily refresh (/api/refresh) ships them.`,
    );
  }

  const withinOneMinute = comparisons ? within / comparisons : 0;
  // No usable stations is a failure of the watch, not a pass.
  const ok =
    comparisons > 0 && worstDelta <= TOLERANCE_MINUTES && withinOneMinute >= REQUIRED_WITHIN_ONE_MINUTE;

  return {
    source: FEED_SOURCE,
    year,
    month,
    stations: reports.length,
    comparisons,
    withinOneMinute: Number(withinOneMinute.toFixed(4)),
    worstDelta,
    worstStation,
    worstPrayer,
    worstDay,
    ok,
    notes: notes.slice(0, 40),
    detail: { stations: reports, timetable: published },
  };
}

/**
 * Node runtime, not edge: this does eight network round trips and a month of
 * astronomy, so it wants the longer budget. That means the Node
 * (request, response) signature rather than the Web one the other routes use.
 */
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
    response.end(JSON.stringify(body, null, 2));
  };

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVER_SECRET) {
    send({ error: 'audit is not configured' }, 503);
    return;
  }

  const header = request.headers.authorization;
  const presented = Array.isArray(header) ? header[0] : header;
  const authorised = CRON_SECRET.length > 0 && presented === `Bearer ${CRON_SECRET}`;

  if (!authorised) {
    // Public read of the last result — accuracy statistics, nothing personal.
    try {
      const latest = await rpc('miqat_latest_audit', { p_secret: SERVER_SECRET });
      // The refresh job's last outcome rides along so one URL shows the whole picture.
      const refresh = await loadStored().then((r) => r.meta).catch(() => null);
      send({ ...((latest as object | null) ?? { status: 'no audit has run yet' }), refresh });
    } catch (error) {
      send({ error: (error as Error).message }, 502);
    }
    return;
  }

  try {
    // Judge exactly what users get, which is the stored table, not the bundled one.
    const stored = await loadStored().catch(() => null);
    if (stored?.doc) setRuntimeTimetable(stored.doc);
    const summary = await runAudit();
    await rpc('miqat_record_audit', { p_secret: SERVER_SECRET, p_payload: summary });
    const alerted = summary.ok ? null : await alert(summary);
    send({ ...summary, alerted }, summary.ok ? 200 : 500);
  } catch (error) {
    send({ error: (error as Error).message }, 502);
  }
}
