import type { Station } from '../src/types.js'
import { withRecoveredCollector, withTransportLock } from './af/browser.js'
import { MARKET } from './af/market.js'

const REFERENCE_HASH = 'c11344fdd1be05827219b57614c2a6a9dfc88a3da3b8c0fd11cbf48443ff6acb'
const STATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000

interface ReferenceResponse {
  data?: {
    flatStations?: Station[]
  }
}

let stationCache: { stations: Station[]; expiresAt: number } | undefined

export const stationReferencePath = (): string => {
  const encodeGraphqlParam = (value: unknown) => encodeURIComponent(JSON.stringify(value))
    .replaceAll('%3A', ':')
    .replaceAll('%2C', ',')
  const variables = encodeGraphqlParam({ bookingFlow: 'LEISURE' })
  const extensions = encodeGraphqlParam({ persistedQuery: { version: 1, sha256Hash: REFERENCE_HASH } })
  return `/gql/v1?bookingFlow=LEISURE&brand=AF&country=${MARKET.country}&language=${MARKET.language}`
    + `&operationName=SharedSearchBoxReferenceDataForSearchQuery&variables=${variables}&extensions=${extensions}`
}

/**
 * Same-origin GET from the collector page. Replaces a `curl --http2` call that
 * fails on Windows curl builds without HTTP/2 and sits outside the browser session.
 */
const getJsonViaBrowser = async <T>(path: string): Promise<T> => (
  withTransportLock(() => withRecoveredCollector(async (page) => {
    const result = await page.evaluate(async (url) => {
      const response = await fetch(url, { credentials: 'include', headers: { accept: 'application/json' } })
      return { status: response.status, text: await response.text() }
    }, path)
    if (result.status !== 200) throw new Error(`Station reference HTTP ${result.status}`)
    return JSON.parse(result.text) as T
  }))
)

let stationLoad: Promise<Station[]> | undefined

const loadStations = async (): Promise<Station[]> => {
  const payload = await getJsonViaBrowser<ReferenceResponse>(stationReferencePath())
  const stations = payload.data?.flatStations
  if (!stations?.length) throw new Error('Air France station reference is empty')
  stationCache = { stations, expiresAt: Date.now() + STATION_CACHE_TTL_MS }
  return stations
}

/** Autocomplete fires per keystroke; share one in-flight load instead of queueing many. */
export async function getAirFranceStations(): Promise<Station[]> {
  if (stationCache && stationCache.expiresAt > Date.now()) return stationCache.stations
  stationLoad ??= loadStations().finally(() => { stationLoad = undefined })
  return stationLoad
}
