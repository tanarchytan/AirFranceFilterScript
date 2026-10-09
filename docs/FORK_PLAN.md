# Fork plan (tanarchytan/AirFranceFilterScript)

Goal: local page for Flying Blue award (miles) search from NL: any airport/city pair,
full-year per-day calendar, one-way and return, N adults, CSV export.

Upstream: RemiPelloux/AirFranceFilterScript @ ce846ef (2026-08-03). Keep diffs small
and upstream-friendly where possible (config via env, defaults unchanged for `fr`).

## Findings that drive the plan (2026-10-07)

- Security review: no exfiltration/telemetry/install hooks. MEDIUM: `server/index.ts:21`
  CORS `origin: true` + no Host check, so any website can drive the local API.
- Market is hardcoded to `fr` in ~10 files; no single config point.
- `CLIENT_REVISION` is a stale constant; the live value is in page HTML (`"revision":"…"`).
- One-way is not supported: `returnDate` required (`index.ts:32`), return leg hardcoded in
  every builder in `variables.ts`.
- Explore truncates the DAY calendar to top 3 per month and hardcodes adults=1 (`index.ts:96`).
- Backoff: linear, no jitter, warm flag never resets after a later 403.
- Our console scanner (`../af-miles-scan.js`) proved: 403 after ~6 rapid requests; 5-7 s
  jittered spacing scanned 279 days fine.

## Steps

1. [x] CORS allowlist (vite origin) + Host check on the API.
2. [x] `server/af/market.ts`: one market object (host, country, language), `AF_MARKET` env,
       fork default `nl`. Replace hardcodes. Read revision from page at runtime.
3. [x] One-way: `tripType` in `src/types.ts` + zod schema + builders + parsers.
4. [x] Miles calendar: Scan trips mode (month/quarter/year/12m, stay length, miles or euros),
       calendar picker with exact flights per leg, rankings, CSV, live progress.
5. [ ] Backoff: jitter, re-warm after 403, cooldown after repeated 403s.
6. [ ] Tests (vitest) for each step, typecheck, one live smoke AMS-OSA.

## Roadmap (agreed 2026-10-09: "yes to all, always find all the best things")

7. [ ] Finnair adapter (Avios + cash): airCalendar / airBounds from a logged-in finnair.com page
       (server/finnair/; capture, probe and try-calendar tools already there). Airline switch in the UI.
8. [ ] Source cooldown: on 403/429 pause that source 10 min, doubling up to 1 h (FlightScout pattern).
9. [ ] "Go somewhere" tab: map + list of destinations, price colours, budget slider, any dates /
       around a date, staged loading. Cash leads from KAYAK Explore / Google Flights Explore;
       miles from Flying Blue MONTH calendars per destination.
10. [ ] Date x nights heatmap next to the scan calendars.
11. [ ] Search beyond miles, always: Google Flights, ITA Matrix, KAYAK and airline sites in parallel,
        every result in one ranked view with the best cash fare and the best miles option side by side.

Reference: FlightScout (github.com/halvis82/FlightScout) has no license, so reimplement from behaviour
and the public site APIs; do not copy code.
