/**
 * Server-side access to the stored timetable. Lives in functions/ rather than
 * src/ because it reads process.env, which the browser build must never see.
 *
 * The database functions refuse anything that arrives without the shared secret,
 * exactly like the analytics and audit ones.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVER_SECRET = process.env.MIQAT_SERVER_SECRET ?? '';

export const dbConfigured = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SERVER_SECRET);

async function rpc(name: string, body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`${name} returned ${response.status}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export interface StoredTimetable {
  /** The validated table, or null/empty before the first change is stored. */
  doc: Record<string, unknown> | null;
  /** The outcome of the latest refresh run. */
  meta: Record<string, unknown> | null;
  updatedAt: string | null;
}

export async function loadStored(): Promise<StoredTimetable> {
  const row = (await rpc('miqat_timetable_get', { p_secret: SERVER_SECRET })) as {
    doc?: Record<string, unknown>;
    meta?: Record<string, unknown>;
    updated_at?: string;
  } | null;
  const doc = row?.doc && Object.keys(row.doc).length > 0 ? row.doc : null;
  return { doc, meta: row?.meta ?? null, updatedAt: row?.updated_at ?? null };
}

/** Pass doc=null to record a run's outcome without touching the stored table. */
export async function storeTimetable(
  doc: Record<string, unknown> | null,
  meta: Record<string, unknown>,
): Promise<void> {
  await rpc('miqat_timetable_put', { p_secret: SERVER_SECRET, p_doc: doc, p_meta: meta });
}
