# Ratline (fork) — Flying Blue / Finnair award + cash search, local

Start of a session: read `HANDOVER.md` (current state, next step), then `docs/FORK_PLAN.md` (roadmap).

## Run

- Package manager: `npx -y pnpm@11.18.0` (no global pnpm).
- `npx -y pnpm@11.18.0 dev` → API http://127.0.0.1:8787 (`tsx watch server/index.ts`) + web http://127.0.0.1:5173.
  Run it as ONE background task; before restarting, stop the old task and kill stale node/vite
  (EADDRINUSE on 8787 shows up in the UI as "Air France is not responding").
- Verify: `npx tsc -b`, `npx -y pnpm@11.18.0 test` (vitest), `npx -y pnpm@11.18.0 lint`.
- Repo lives on local disk `C:\Users\DavidGillot\Projects\flying\ratline`. Never the NAS copy (`P:\flying\ratline`, stale, too slow).
- The machine is often low on memory: commands can take minutes. Prefer Read/Edit over long shell pipelines.

## Layout

- `server/af/`: Air France. `market.ts` (AF_MARKET, default `nl`), `hashes.ts` (persisted-query hashes, client revision),
  `transport.ts` (in-page GraphQL fetch, retry, cooldown), `browser.ts` / `browser-launch.ts` (Patchright Chrome, persistent
  profile `.airfrance-browser-profile`, off-screen/minimised), `auth-login.ts` + `session-store.ts` (login, saved cookies,
  silent SSO re-login), `gql-client.ts` + `http-client.ts` (impit first, browser fallback), `reward*.ts`, `trip-scan*.ts`.
- `server/finnair/`: discovery tools only so far (capture, probe, try-calendar). Adapter is roadmap step 7.
- `server/source-cooldown.ts`: per-source pause after blocks, 10 min doubling to 1 h.
- `src/`: React UI. `App.tsx`, `ScanPanel.tsx`, `ScanCalendar.tsx`, `lib/calendar.ts`.

## Air France facts that bite

- airfrance.nl returns `{"data":{}}` (no error) when a persisted hash is stale OR the URL `operationName` differs from the
  body's. Send the real operation name (`AF_SPOOF_OPERATION=1` only for airfrance.fr). New hashes: site JS chunk with the
  `{id:"…",name:"…"}` list.
- Every GQL call needs the market headers (`cashHeaders`) plus `x-aviato-host` and the live `x-client-revision` from page HTML,
  else `OFA/TECHNICAL/MISSING_HEADER`.
- Award calls need hashcash v2 (`server/af/hashcash.ts`). Akamai blocks curl, headless and rapid replays: keep ≥5 s spacing.
- `AF_CAPTURE=1` logs site traffic to `.airfrance-capture.jsonl` (never cookie values).

## Rules

- Session, profile and capture files (`.airfrance-*`, `.finnair-*`) stay local and gitignored. Never print or commit cookies.
- `git add` explicit paths only (guard hook blocks `git add -A`). Commits as tanarchytan / admin@tanarchy.org.
- Push needs David's approval; he pushes himself with `! cd C:/Users/DavidGillot/Projects/flying/ratline && git push`.
- FlightScout (halvis82) has no license: reimplement from behaviour, never copy code.
- Points transfers are final: check award availability before advising a transfer.
