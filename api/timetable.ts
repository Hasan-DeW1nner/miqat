export const config = { runtime: 'edge' };

/**
 * The server's copy of the validated Awqaf timetable, which a daily job
 * (functions/refresh.ts) keeps current.
 *
 * Public on purpose: it is published prayer times and nothing else. The shared
 * secret only ever travels from here to the database. Where there is nothing
 * stored, or anything goes wrong, this answers 204 and the app carries on with
 * the copy bundled into it, so a failure here can never blank the times.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVER_SECRET = process.env.MIQAT_SERVER_SECRET ?? '';

const none = () =>
  new Response(null, { status: 204, headers: { 'cache-control': 'public, s-maxage=60' } });

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET') return new Response(null, { status: 405 });
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVER_SECRET) return none();

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/miqat_timetable_get`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ p_secret: SERVER_SECRET }),
    });
    if (!response.ok) return none();

    const row = (await response.json()) as { doc?: { years?: unknown } } | null;
    if (!row?.doc || !row.doc.years) return none();

    return new Response(JSON.stringify(row.doc), {
      headers: {
        'content-type': 'application/json',
        // Browsers keep it five minutes; the edge keeps it fifteen and may serve
        // a day-old copy while it fetches a new one.
        'cache-control': 'public, max-age=300, s-maxage=900, stale-while-revalidate=86400',
      },
    });
  } catch {
    return none();
  }
}
