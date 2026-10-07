# Ratline: Air France deal desk

TypeScript successor to [AirFranceFilterScript](https://github.com/RemiPelloux/AirFranceFilterScript): same proven GraphQL / Akamai transport, modern deal desk interface.

**Ratline** compares **euro** fares and **Flying Blue Miles**, explores the best days over 12 months, and ranks offers (cost, duration, stops, Pareto), all locally, with no partner API.

---

## Features

- Return search with a flexible window (±30 days, max. 7 exact repricings)
- Monthly Open Dates return calendar (€ and Miles kept separate, `totalPriceItinerary` floor)
- **Explore** mode: Top 3 return fares per month from a single `DAY` calendar (no more monthly N+1)
- Local ranking (generalised cost + Pareto frontier)
- Flying Blue session imported via cookies (no password / OTP handling)
- Visible Chrome collector via Patchright (same-origin `fetch`)
- Chrome / Akamai warm-up at API start (faster first search)
- 120 s live cache of fare captures
- Automatic recovery when the Chrome profile is locked (ephemeral browser fallback)
- Best-effort Akamai warm-up: a failure no longer blocks the search

---

## Requirements

- Node.js 22+
- [pnpm](https://pnpm.io) 11+ (`corepack enable`)
- Brave (recommended) or Google Chrome
- macOS / Linux / Windows

---

## Installation

```bash
git clone https://github.com/RemiPelloux/AirFranceFilterScript.git
cd AirFranceFilterScript
corepack enable
pnpm install
```

---

## Running

```bash
pnpm dev
```

On start, the API warms up Chrome on `wwws.airfrance.fr`. Leave the window open: Akamai rejects headless mode.

| Service | URL |
| --- | --- |
| UI | http://127.0.0.1:5173 |
| API | http://127.0.0.1:8787 |

If port 8787 is already taken, or if Chrome refuses the profile ("existing session" message), stop any old `pnpm dev` / Chrome instances tied to the project, then restart:

```bash
# macOS / Linux: free the ports, then restart
lsof -ti:5173,8787 | xargs kill -9 2>/dev/null
pnpm dev
```

---

## Usage

1. Pick origin / destination (Air France station autocomplete)
2. Dates, cabin, payment mode: **euros**, **Miles** or **both**
3. **Search** for exact offers, or **Explore** for the monthly Top 3
4. Click a month or a day to reprice the return trip

### Flying Blue session (Miles)

When you enable **Miles** / **Compare**, Ratline opens Chrome on the Air France login page and waits. Log in (Flying Blue / OTP), then click **I'm logged in** to verify the session and collect the browser profile cookies.

Optional: import cookies you have already exported:

```bash
pnpm session:import -- /path/to/cookies.json
```

Cookies live in `.airfrance-browser-profile/` (gitignored). Endpoints: `POST /api/auth/open`, `POST /api/auth/confirm`, `GET /api/auth/status`.

---

## Checks

```bash
pnpm test              # parsers + hashcash
pnpm typecheck
pnpm build
pnpm test:live         # cash smoke NCE → RUN (real network)
pnpm test:reward       # Miles smoke (session required)
```

---

## Architecture

```text
React / Vite (:5173)
        │  /api
        ▼
Fastify (:8787)
        │
        ▼
server/af/  (Patchright collector)
        │
        ▼
Visible Chrome → wwws.airfrance.fr/gql/v1
```

| Layer | Role |
| --- | --- |
| `src/` | Deal desk UI, ranking, stations |
| `server/index.ts` | API `/api/search`, `/api/explore`, `/api/stations` |
| `server/af/` | FilterScript transport, cash, reward, parsers |
| `server/airfrance.ts` | Station catalogue (curl HTTP/2) |

### Transport (inherited from FilterScript)

1. Visible Brave / Chrome (Brave first, or `AF_BROWSER_EXECUTABLE`)
2. Persistent profile `.airfrance-browser-profile/` (ephemeral fallback if locked)
3. Same-origin `page.evaluate(fetch)`, `credentials: 'include'`
4. URL always `operationName=SharedSearchLowestFareOffersForSearchQuery`; the real operation is in the body
5. Akamai warm-up + refresh + retry on HTML 403
6. Explore batch: chunks of 5, concurrency 3, 350 ms pause

### Cash vs Miles

| | Cash (LEISURE) | Miles (REWARD) |
| --- | --- | --- |
| Context | Local UUID | `SearchCustomer` + `CreateSearchContext` + PROFILE passengers |
| Hashcash | no | yes (v2) |
| Revision headers | no | `x-client-revision` |
| Default hashes | FilterScript (`3129e428…` / `6c2316d3…`) | same + Ratline August 2026 fallback |

---

## Environment variables

| Variable | Role |
| --- | --- |
| `AF_BROWSER_EXECUTABLE` | Force a Chrome / Brave path |
| `AF_BROWSER_PROFILE` | Profile folder (default `.airfrance-browser-profile`) |
| `AF_CDP_ENDPOINT` | Attach to an already open Chrome |
| `AF_LOWEST_FARE_HASH` | Override the LowestFare hash |
| `AF_AVAILABLE_OFFERS_HASH` | Override the AvailableOffers hash |
| `AF_CLIENT_REVISION` | Client revision (Reward) |
| `PORT` | API port (default `8787`) |

---

## Documentation

- [docs/AIRFRANCE_NETWORK_AUDIT.md](docs/AIRFRANCE_NETWORK_AUDIT.md): verified GraphQL protocol (French)
- [docs/ETAT_DES_LIEUX_ET_CAHIER_DES_CHARGES.md](docs/ETAT_DES_LIEUX_ET_CAHIER_DES_CHARGES.md): product requirements (French)

---

## Limits

- Visible Chrome is required
- One collector at a time (local queue)
- Akamai may block temporarily after too many requests (retry + refresh)
- Persisted hashes may change if Air France updates its frontend
- No public partner API: personal / local use only

---

## History

This repo started as an **AF / HOP** Flask filter. It is now **Ratline**: a TypeScript stack (React + Fastify + Patchright), a cash / Miles deal desk, and the Akamai transport inherited from FilterScript, with automatic Chrome session recovery and warm-up.
