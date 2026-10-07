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
4. [ ] Miles calendar: endpoint returning every day (miles, taxes) for N adults, one-way or
       return, over a date range (MONTH + DAY per month), CSV download in the UI.
5. [ ] Backoff: jitter, re-warm after 403, cooldown after repeated 403s.
6. [ ] Tests (vitest) for each step, typecheck, one live smoke AMS-OSA.
