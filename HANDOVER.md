# Handover, 2026-10-09

Read `CLAUDE.md` first (how to run, rules). This file is the state at hand-off.

## Where things stand

- Branch `feat/nl-miles` on the fork `tanarchytan/AirFranceFilterScript`, pushed up to `b08370f`.
  Working tree: only this handover, `CLAUDE.md` and `docs/FORK_PLAN.md` ticks (commit them).
- Air France / Flying Blue on airfrance.nl works end to end:
  - station autocomplete (`/api/stations?q=kix` 200),
  - one-way and return search, N adults, miles and cash,
  - Scan trips: month / quarter / year / 12 months, stay any or fixed, rankings
    "fewest miles" + "best value" + "cheapest outbound then its returns", progress bar,
  - two Mon-first calendar pickers (outbound, return) with exact flights per leg, CSV.
- Live results seen: AMS-OSA one-way 2 adults 2027-01-13 = 60,000 mi + EUR 460;
  Q4 2026 return best 120,000 mi + EUR 630.
- Not yet confirmed by David after today's fixes: one full scan from the UI with no
  "Failed to fetch". Ask for that first.

## Fixed today (2026-10-09)

| Commit | Fix |
|---|---|
| `0a4abd8` | Scans try impit (browserless, saved cookies) first, fall back to hidden Chrome |
| `61d13f7` | Return the tab to airfrance.nl before in-page GraphQL (login left it on the identity site: "Failed to fetch") |
| `5a31f00` | Network errors keep the underlying Chromium cause in the message |
| `b08370f` | Vite ignores `.airfrance-*` / `.finnair-*`; Chrome writing `offscreen.html` into the profile full-reloaded the UI mid-scan |

"Air France is not responding" this morning was not Air France: the API had died with
EADDRINUSE on 8787 (stale dev server). Kill stale node/vite processes before restarting.

## Next, in order

1. **David verifies a scan** (reload http://127.0.0.1:5173, type KIX, run a quarter scan).
2. **Roadmap 7, Finnair adapter (Avios + cash), ~3-4 h.** Login works (CAS SSO completes
   silently). Endpoints: `api.finnair.com/d/fcom/offers-prod/current/api/airCalendar` and
   `/airBounds`; headers Bearer token, `x-client-id: FCOM`, `x-dd-flow-type: award|flight`.
   Award needs the app login. Space requests 6-7 s, reuse `sourceCooldowns`. Discovery tools in
   `server/finnair/` (capture.ts, probe.ts, try-calendar.ts). Then an airline switch in the UI.
3. Roadmap 9, "Go somewhere" tab (~3 h). 4. Roadmap 10, date x nights heatmap (~2 h).
5. Roadmap 11, cash from Google Flights / ITA / KAYAK in parallel (~1 day).
   Details in `docs/FORK_PLAN.md`.

## Open risks

- Akamai: impit works only intermittently; the browser path is the reliable one. Never
  fire requests faster than ~5 s apart per source.
- AF persisted-query hashes rotate with site releases. Symptom: `{"data":{}}` with no error.
  Fix: take new hashes from the site chunk with the `{id:…,name:…}` list (see CLAUDE.md).
- Login session lasts ~4 h; silent SSO re-login via `KLMCOM.SSOCOOKIE` handles it.
- Port 8787 is also the documented port of the headroom proxy (`~/.claude/global-memory/`).
  Not active on 2026-10-09; if it comes back, move Ratline's API port.

## Outside this repo

- `P:\flying\japan-award-options.md`: Amex NL Membership Rewards to Japan analysis (done).
  Transfers are final: check award space first. Never park Avios in Finnair Plus (18-month expiry).
- `P:\flying\af-miles-scan.js`: the original DevTools console scanner (superseded by Ratline).
- `P:\flying\ratline`: stale first clone on the NAS. Do not work there.
- Memory: `~/.claude/projects/P--flying/memory/af-award-scanner.md`.
