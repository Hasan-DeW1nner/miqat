# Miqāt — prayer times

A web app that computes prayer times on the device, from the sun's position, with every
parameter that decides a minute exposed and checkable.

**Live:** <https://miqat-sepia.vercel.app> · **Status:** active, deployed · React + TypeScript · installable PWA

```bash
git clone https://github.com/letssay-ANONYMOUS/miqat.git
cd miqat
npm install
npm run dev        # http://localhost:5183
npm run verify     # accuracy regression against the official timetables
```

No API key is needed to run the app. Every service it talks to is keyless, and prayer times
are never fetched — the network is only used to find *where* you are. The environment
variables in [Environment](#environment) are for the optional usage-reporting endpoints only.

## Screens

| The board | The day | The month |
| --- | --- | --- |
| ![Countdown to the next prayer over a sky tinted by the real sun](docs/screenshots/board.png) | ![The six prayers with what each one actually marks](docs/screenshots/times.png) | ![September 2026 for Dubai, served from the Awqaf table](docs/screenshots/month.png) |

Dubai, 16 September 2026. The background is not a gradient someone picked — `lib/sun.ts`
computes the sun's altitude for your coordinates and `lib/sky.ts` turns that into the colour,
so the page is dark here because the sun is actually down.

## Architecture

```mermaid
flowchart TB
    subgraph device["Browser · everything that decides a prayer time runs here"]
        UI["React 19 + Zustand<br/>sky, board, Qibla, mushaf"]
        ENGINE["lib/prayer.ts<br/>adhan-js · Meeus equations<br/>+ elevation &amp; rounding"]
        TABLE["lib/officialTimetable.ts<br/>Awqaf table, shipped in the bundle"]
        SW["service worker<br/>offline app shell"]
        UI --> ENGINE
        ENGINE -->|"covered date?"| TABLE
    end

    subgraph edge["Vercel Edge Functions"]
        TRACK["/api/track<br/>the only write path"]
        AUDIT["/api/audit<br/>daily accuracy cron"]
        FORGET["/api/forget<br/>erasure"]
    end

    subgraph ext["Keyless third parties"]
        GEO["Open-Meteo geocoding<br/>BigDataCloud reverse"]
        ALAD["AlAdhan API<br/>independent cross-check"]
    end

    DB[("Supabase Postgres<br/>RLS on, no policies<br/>one definer function")]

    UI -.->|"where am I"| GEO
    UI -.->|"check the maths"| ALAD
    UI --> TRACK --> DB
    UI --> FORGET --> DB
    AUDIT -->|"recompute + diff"| DB
    GN["Gulf News<br/>Awqaf republisher"] --> AUDIT
```

Two things are deliberate in that picture. **No arrow carries a prayer time into the
browser** — the times are computed or read from a table already in the bundle, so the app
works with the radio off. And **nothing writes to the database from the client**: the
publishable key and a shared secret live only in the Edge Function, so the shipped bundle
carries no database credential at all.

## What the research turned up

**There is no secret prayer-times API.** Athan Pro (Quanticapps) and Athan (IslamicFinder) —
the two big blue-icon apps — both compute times locally from astronomy. Quanticapps' own
support pages give it away: the app "automatically adjusts prayer times according to the ones
used by the largest mosques and Islamic ministries in each country", it works offline, and
when times don't match your mosque the fix they offer is to change the calculation method or
apply a manual correction. That is a local solar calculation with a per-country preset, not a
feed.

So accuracy is not an API-shopping problem. It comes down to four things:

1. **Coordinates.** Prayer times move ~4 minutes per degree of longitude.
2. **Convention.** Which Fajr/Isha angle the local authority uses, plus its own rounding and
   safety offsets.
3. **Asr rule.** Shadow length ×1 (standard) or ×2 (Hanafi) — up to an hour apart.
4. **The last few minutes.** Elevation, and whatever your mosque actually does.

## How this app is built

| Layer | Choice | Why |
| --- | --- | --- |
| Engine | [`adhan`](https://github.com/batoulapps/adhan-js) (Batoul Apps) | High-precision equations from Jean Meeus' *Astronomical Algorithms*. Runs offline, no rate limit, instant. |
| Cross-check | [api.aladhan.com](https://aladhan.com/prayer-times-api) | Free, no key, CORS-open. A second independent implementation to diff against. |
| City search | [Open-Meteo geocoding](https://open-meteo.com/en/docs/geocoding-api) | Free, no key, returns IANA timezone **and** elevation. |
| Reverse geocode | [BigDataCloud](https://www.bigdatacloud.com/) client endpoint | Free, no key, names a GPS fix. |

Times are never fetched to be displayed — the network is only ever used to find *where* you
are and to verify the maths.

### Accuracy features

- 23 published conventions, auto-selected from the country of your location.
- Asr madhab, high-latitude rule, and Moonsighting shafaq.
- **Elevation correction.** Horizon dip of `0.0347·√h` degrees, converted to a time shift
  through the sunrise hour angle, applied to sunrise and Maghrib before rounding. At Al Ain's
  275 m that is 2.6 minutes.
- **Per-prayer manual correction.** The only honest way to match one specific mosque.
- **Independent check** in-app: same parameters sent to AlAdhan, diffed minute by minute.

### What `npm run verify` found

The UAE preset that both libraries ship is wrong, in opposite directions. Fitted against the
official Awqaf timetable for Dubai:

| Preset | Asr | Sunrise |
| --- | --- | --- |
| `adhan` Dubai (`asr +3`) | wrong all 31 days, up to 3 min late | correct |
| AlAdhan method 16 (`sunrise +0`) | correct | wrong all 31 days, up to 4 min late |
| **This app** (`sunrise −3, dhuhr +3, asr +1, maghrib +3`) | 29/31 exact | 18/31 exact |

The regression then widened to all seven emirates plus Al Ain, eight months of 2026, from an
independent publisher of the same official table — **11,616 published times**:

```
UAE · Awqaf via Gulf News · computed from the sun · tolerance 3 min
  Dubai            241 days · worst 1 min · 100.0% within a minute
  Abu Dhabi        243 days · worst 1 min · 100.0% within a minute
  Sharjah          242 days · worst 1 min · 100.0% within a minute
  Ajman            243 days · worst 2 min ·  99.9% within a minute
  Fujairah         243 days · worst 3 min ·  99.9% within a minute
  Ras Al Khaimah   242 days · worst 2 min ·  99.9% within a minute
  Umm Al Quwain    241 days · worst 1 min · 100.0% within a minute
  Al Ain           241 days · worst 1 min · 100.0% within a minute
  ──────────────────────────────────────────────────────────
  100.0% of 11616 checks within a minute (needs 99%)
       fajr     worst  1 min · exact on 91%
       sunrise  worst  2 min · exact on 91%
       dhuhr    worst  3 min · exact on 98%
       asr      worst  1 min · exact on 62%
       maghrib  worst  2 min · exact on 90%
       isha     worst  1 min · exact on 89%
```

### The pass that nearly stopped testing anything

Once the shipped timetable landed (below), `computeDay` began returning Awqaf's published
row verbatim for exactly the dates this suite covers — so the suite was diffing the table
against the table it was built from and printing a flawless zero. A perfect score that
cannot fail is worse than no test.

The suite now runs the engine with the lookup path switched off, which is the number above,
and then runs a **second** pass with it on, where an exact match is the actual requirement:

```
UAE · Awqaf via Gulf News · shipped timetable · tolerance 0 min
  all 8 cities · worst 0 min · 100.0% of 11616 checks exact
```

Two different claims, measured separately: the astronomy is within a minute of the
authority, and the build pipeline copied the authority's table without corrupting it.

### The terrain correction, and why Al Ain caught it

Al Ain used to sit at 88% while every other city was above 99%. It is the only station Awqaf
publishes that has real height — 275 m against 3–15 m everywhere else — and it was the only one
where sunrise ran late *and* Maghrib ran early, i.e. the computed day was shorter than the
published one. Nothing else does that: elevation is the only input that moves sunrise and sunset
without touching Fajr, Dhuhr, Asr or Isha.

The obvious fix was wrong. Feeding the true 275 m made it *worse* (85.8%), because standing high
on a plateau is not standing on a tower — the land around you is high too, so the horizon barely
drops. Awqaf's table behaves like roughly 75 m. The convention therefore carries a
`horizonFactor` of 0.27, applied through the same dip-to-hour-angle maths so it still varies
correctly with date and latitude. Al Ain went to 100%; the sea-level cities moved by a fifth of a
minute, which rounds away.

Two lessons are baked into `npm run verify` as a result: the reference stations carry their
elevation so this path is actually under test, and the fixture builder drops single-day spikes —
a value several minutes off both its neighbours, which the sun cannot do — because three of those
typos in the published feed were masquerading as engine error.

Dubai is exact because that is the city Awqaf computes for. Everywhere else the residual is
Awqaf's own reference point — one spot per emirate — against the app's use of your actual
coordinates, plus a handful of days the feed plainly mistypes.

Three things worth knowing, all found by running this:

- **Khaleej Times' per-emirate tables are an approximation.** Their Abu Dhabi table is the Dubai
  table plus a flat 4 minutes; their Umm Al Quwain table *is* the Dubai table. Gulf News carries
  the real per-city Awqaf figures. Both are kept in `reference/`, the second as a cross-check.
- **Gulf News' feed silently invents data past the published calendar.** Beyond the current
  month it falls back to a generic fixed-90-minute-Isha calculation. The tell is an
  Isha-after-Maghrib gap that never varies; the fixture builder rejects any month showing it.
- **Elevation is off by default.** Published timetables are computed at sea level, so applying
  the correction is truer to your horizon but a minute or two off the time your mosque calls.

## Iqama, notifications, Qibla

- **Adhan / Iqama toggle** at the top of the board switches every time, and the countdown with
  it. Defaults are Awqaf's standard — 20 minutes for Fajr, Dhuhr, Asr and Isha, 5 for Maghrib,
  none for sunrise — and each is adjustable. Friday swaps Dhuhr for Jumuʿah at a fixed clock time.
- **Notifications** fire while the page is open. Waking a locked phone needs Web Push behind a
  service worker, and on iOS the app installed to the home screen first; the UI says so rather
  than implying an alarm clock it cannot be.
- **Qibla** is a great-circle bearing to the Kaaba, checked against an independent implementation
  to three decimals. The dial reports whether the phone's compass is referenced to true or
  magnetic north, and flags when the sensor says it needs calibrating.

## The sky

The background is the real sun, in the real place it is right now — `lib/sun.ts` computes its
altitude and hour angle from the location, `lib/sky.ts` turns altitude into a colour, and the
page tints continuously as it climbs to Dhuhr, sinks through Asr, burns at Maghrib and sets by
Isha. The UI flips to dark ink on a light sky once the sun is a few degrees up.

No WebGL, no canvas, no library, no per-frame work: the whole scene is layered radial gradients
on composited elements, the position updates once every thirty seconds, and CSS transitions carry
it between. The roundness is an off-centre highlight plus a darkened lower rim, which is what
actually reads as a sphere at this size. It is the only heavy-looking thing in the app and it
costs about 6 kB of CSS.

## The shipped timetable

Awqaf already decides the angle, the rounding, the terrain and every seasonal
adjustment. Where they publish a table, the app carries it and shows it — no calculation
involved, so it matches the mosque exactly rather than approximately.

It keeps itself current. A daily Vercel job (`functions/refresh.ts`, 01:30 UTC) pulls any newly
published days from the feed, runs them through the checks below, and stores the result in the
database. The app fetches that from `/api/timetable` and prefers it over the copy bundled into
the build, so new months reach users without a deploy. The bundled copy is only the floor for a
first or offline visit; refresh it before a deploy with:

```bash
npm run build:timetable   # fetch, validate, write src/data
```

Nothing enters the table untested (`src/lib/timetableBuild.ts`, shared by both paths). Each day
must run forwards, must not be the feed's fixed-90-minute-Isha filler, must sit within eight
minutes of our own astronomy, and must not jump away from its neighbours. Each month must also
average within about a minute of the sun: a feed that is a steady minute or two off passes every
per-day check, which is how Dubai's October 2026 was caught: Gulf News was serving Ajman's table
under Dubai's name, identical on all 31 days. A day or month that fails is left out and the app
calculates it instead; a gap is recoverable, a wrong prayer time is not. Held months are listed
in the table's `held` array and in `/api/audit` under `refresh.heldMonths`.

For Dubai there is a second publisher. When the Gulf News month fails, the current month is read
from Khaleej Times (`src/lib/khaleejFeed.ts`) and put through the same checks; it is recorded in
the table's `sources` array. Only Dubai: Khaleej Times' other emirates are derived (Abu Dhabi is
Dubai plus four minutes flat), not published per city.

The refresh only ever adds. If the feed disagrees with a day that is already live, or drops one,
that city-month is left untouched and the run reports it as `refused`. It can be called by anyone
but only runs if the last run is over six hours old (the cron secret overrides that).

```
GET /api/refresh     → run if stale, else report the last run
GET /api/timetable   → the stored table, or 204 and the app uses its bundled copy
```

Each run checks every month from now to the end of next year that is not yet complete, so a new
year's table is picked up the day Awqaf publishes it. Calculation remains the
fallback for towns with no published table, dates past the end of it, and the rest of the world;
the app says which one you are looking at. Coverage today is Jan–Oct 2026 for eight cities
(Dubai October from Khaleej Times; Abu Dhabi 6 Oct is a feed gap and is calculated). As of
October 2026 the feed serves only placeholders from November onward, 2027 included.

## The standing accuracy watch

Awqaf publishes no API and issues no keys — their site and Dubai's IACAD open-data page both
refuse scripts. So `/api/audit` reads the timetable Gulf News republishes, recomputes the entire
current month for all eight cities Awqaf lists separately, and diffs the two. A Vercel cron runs
it daily; the result is written to `miqat_accuracy_checks` and shown in the app under Accuracy.

The feed is undocumented and lies in two known ways, both guarded in `lib/awqafFeed.ts`: past the
published calendar it silently serves a generic fixed-90-minute-Isha calculation instead of
nothing (the tell is an Isha-after-Maghrib gap that never varies), and individual days carry
typos (a value several minutes off both neighbours, which the sun cannot do). Either would
otherwise be reported as drift that isn't there. A run with no usable stations fails rather than
passing quietly.

```
GET /api/audit                          → the last verdict, public
GET /api/audit  (with the cron secret)  → run it now, record, return
```

Last run: 1,482 comparisons, 100% within a minute, worst gap 1 minute.

## Analytics, on your own machine

```bash
npm --prefix miqat run analytics    # http://127.0.0.1:7823
```

No Miqāt account and nothing hosted. The server binds to the loopback address only, credentials
live in `~/.miqat/config.json` at mode 0600, and the secret never reaches the browser — the page
asks the local process, which asks the database. Shows visitors, visits, places, countries,
devices, a per-day chart, and a world map of the precise fixes people have opted into sharing.

## Usage reporting

`miqat_` tables in the shared STERK Supabase project, alongside the `shop_` ones.

Two tiers, separated on purpose. Every visit records a random id, a visit count, and the town the
app already resolved. Precise coordinates are stored **only** after an unticked-by-default opt-in
under Settings → Privacy — and that is enforced in the database function, not just the UI, so the
switch cannot be bypassed from the client. Consent grants and withdrawals are logged with the
policy version, and `miqat_forget` deletes a visitor and everything cascading from them.

Nothing writes to the database from the browser. The page posts to this app's own `/api/track`,
which holds the key and a shared secret server-side, hashes the caller's IP for rate limiting and
validates every field; the database function ignores anything arriving without that secret. So
the published bundle contains no database credential at all, and a request forged against
Supabase directly writes nothing.

RLS is on with no policies, so even the anon key cannot read or write the tables; everything goes
through one definer function. No visitor can ever read another's location. Read your own data
from the `miqat_dashboard` view in the Supabase SQL editor.

## Environment

Nothing here is needed to run, build or verify the app — clone it and `npm run dev` works.
These exist only for the usage-reporting and audit endpoints under `api/`, and in production
Vercel injects them.

```bash
cp .env.example .env.local
```

| Variable | Required for | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | `/api/track`, `/api/audit`, `/api/forget` | Project URL. |
| `SUPABASE_ANON_KEY` | the same | Publishable key. RLS is on with no policies, so it reads and writes nothing on its own. |
| `MIQAT_SERVER_SECRET` | the same | Shared secret the definer function checks. Server-side only — it must never reach the bundle. |
| `MIQAT_IP_SALT` | `/api/track` | Salts the IP hash used for rate limiting. Raw IPs are never stored. |
| `CRON_SECRET` | `/api/audit` | Guards the write-and-record run of the daily audit. |
| `ALERT_WEBHOOK_URL` | `/api/audit` | Optional. Where drift is reported. |

## Deployment

Vercel. `npm run build` typechecks the app and the Edge Functions, compiles `functions/` into
`api/`, builds the client, then generates the service worker with a content-hashed precache
manifest. `vercel.json` carries the SPA rewrite, immutable caching for hashed assets, and the
cron entry that calls `/api/audit` once a day.

## Layout

```
src/lib/methods.ts   calculation conventions + country→method map
src/lib/prayer.ts    engine wrapper, elevation correction, next-prayer logic
src/lib/time.ts      timezone-correct formatting (never uses the device zone by accident)
src/lib/geo.ts       GPS, city search, reverse geocode, elevation
src/lib/verify.ts    in-app cross-check against AlAdhan
src/lib/analytics.ts usage reporting, with the consent split
src/lib/uaePlaces.ts tap-to-pick list of UAE towns
scripts/verify.ts    regression against the official timetables in reference/
```
