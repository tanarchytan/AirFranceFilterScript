import { randomUUID } from 'node:crypto'
import type { DayFare, ScanProgress, SearchRequest, TripScanRequest, TripScanResponse } from '../../src/types.js'
import { withRecoveredCollector, withTransportLock } from './browser.js'
import { FlyingBlueAuthError } from './hashcash.js'
import { browserClient, type GqlClient } from './gql-client.js'
import { LOWEST_FARE_HASH, RATLINE_LOWEST_FARE_HASH } from './hashes.js'
import { createHttpClient } from './http-client.js'
import { saveSessionCookies } from './session-store.js'
import { isBlockError, sourceCooldowns } from '../source-cooldown.js'
import { prepareRewardSession, rewardTransportOptions } from './reward-session.js'
import { warmAkamaiSession } from './session-warm.js'
import {
  BOOKING_WINDOW_DAYS,
  cheapestOutboundsWithReturns,
  combineTrips,
  dayFaresFrom,
  MAX_ANY_STAY_NIGHTS,
  monthChunks,
  periodRange,
  rankTrips,
} from './trip-scan.js'
import type { LowestFarePayload } from './types.js'
import { addDays, lowestFareVariables } from './variables.js'

const RANK_LIMIT = 25
/** Cooldown key for the browserless (impit) route, separate from Air France as a whole. */
const HTTP_SOURCE = 'airfrance-http'
/** Akamai 403'd ~6 rapid calls in testing; space calendar calls 1.5 to 2.5 s apart. */
const MIN_GAP_MS = 1_500
const JITTER_MS = 1_000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** One scan at a time (the transport lock serialises them), so one shared progress record. */
let progress: ScanProgress = { running: false, done: 0, total: 0, label: '' }
export const getScanProgress = (): ScanProgress => progress

const monthLabel = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const today = () => new Date().toISOString().slice(0, 10)

/** One-way search request for one direction; the calendar only reads route, cabin and adults. */
const legRequest = (scan: TripScanRequest, reverse: boolean): SearchRequest => ({
  origin: reverse ? scan.destination : scan.origin,
  destination: reverse ? scan.origin : scan.destination,
  tripType: 'oneway',
  departureDate: today(),
  returnDate: today(),
  flexibleDays: 0,
  tripLengthDays: 1,
  cabins: scan.cabins,
  paymentMode: scan.paymentMode,
  adults: scan.adults,
  maxStops: 2,
  maxDurationHours: 72,
  nearbyAirports: true,
  separateTickets: false,
  longLayover: false,
  mileValueCents: scan.mileValueCents,
})

/** DAY calendar per calendar month for one direction. */
const scanLeg = async (
  client: GqlClient,
  request: SearchRequest,
  from: string,
  to: string,
  direction: 'Outbound' | 'Return',
): Promise<DayFare[]> => {
  // Cash calendars need no login, traveler keys or proof of work.
  const cash = request.paymentMode === 'cash'
  const { searchStateUuid, companions } = cash
    ? { searchStateUuid: randomUUID(), companions: undefined }
    : await prepareRewardSession(client, request)
  const days: DayFare[] = []
  for (const [first, last] of monthChunks(from, to)) {
    await sleep(MIN_GAP_MS + Math.random() * JITTER_MS)
    progress = { ...progress, label: `${direction} ${monthLabel.format(new Date(`${first}T00:00:00Z`))}` }
    const variables = lowestFareVariables(
      { ...request, departureDate: first }, searchStateUuid, cash ? 'LEISURE' : 'REWARD', first, last, 'DAY', companions,
    )
    const payload = cash
      ? await client.post<LowestFarePayload>('SharedSearchLowestFareOffersForSearchQuery', LOWEST_FARE_HASH, variables)
      : await client.post<LowestFarePayload>('SharedSearchLowestFareOffersForSearchQuery', RATLINE_LOWEST_FARE_HASH, variables, rewardTransportOptions)
    days.push(...dayFaresFrom(payload.data?.lowestFareOffers?.lowestOffers ?? [])
      .filter((day) => day.date >= first && day.date <= last))
    progress = { ...progress, done: progress.done + 1 }
  }
  return days
}

export const scanRewardTrips = async (scan: TripScanRequest): Promise<TripScanResponse> => {
  const startedAt = Date.now()
  const [from, to] = periodRange(scan.period, today())
  const windowEnd = addDays(today(), BOOKING_WINDOW_DAYS)
  const lastReturn = addDays(to, scan.stayNights ?? MAX_ANY_STAY_NIGHTS)
  const returnRange: [string, string] = [addDays(from, 1), lastReturn < windowEnd ? lastReturn : windowEnd]
  const total = monthChunks(from, to).length + (scan.tripType === 'return' ? monthChunks(...returnRange).length : 0)
  const run = async (client: GqlClient): Promise<TripScanResponse> => {
    progress = {
      running: true, done: 0, total, startedAt: new Date().toISOString(),
      label: scan.paymentMode === 'cash' ? 'Opening Air France' : 'Checking the Flying Blue login',
    }
    const outbound = await scanLeg(client, legRequest(scan, false), from, to, 'Outbound')
    let inbound: DayFare[] | undefined
    if (scan.tripType === 'return') {
      inbound = await scanLeg(client, legRequest(scan, true), ...returnRange, 'Return')
    }
    const currency = scan.paymentMode === 'cash' ? 'EUR' as const : 'MILES' as const
    const trips = combineTrips(outbound, inbound, { stayNights: scan.stayNights, mileValueCents: scan.mileValueCents, currency })
    return {
      currency,
      from,
      to,
      outbound,
      ...(inbound ? { inbound } : {}),
      byPrice: rankTrips(trips, 'price', RANK_LIMIT),
      byValue: rankTrips(trips, 'value', RANK_LIMIT),
      byOutbound: cheapestOutboundsWithReturns(outbound, trips, { outboundLimit: 10, returnLimit: 5 }),
      requests: progress.done,
      durationMs: Date.now() - startedAt,
      transport: client.kind,
    }
  }

  try {
    // Browserless first (impit + saved cookies); the browser only when Air France refuses it.
    // Akamai refuses impit intermittently; after a block, skip it for a while (10 min doubling
    // to 1 h) so failed attempts do not make it suspicious of the browser session as well.
    const httpPaused = sourceCooldowns.remainingMs(HTTP_SOURCE) > 0
    const http = httpPaused ? undefined : await createHttpClient()
    let fallbackReason = httpPaused ? 'direct mode paused after a recent block' : http ? undefined : 'no saved browser session yet'
    if (http) {
      try {
        const result = await run(http)
        sourceCooldowns.recordSuccess(HTTP_SOURCE)
        return result
      } catch (error) {
        if (!isBlockError(error) && !(error instanceof FlyingBlueAuthError)) throw error
        if (isBlockError(error)) sourceCooldowns.recordBlock(HTTP_SOURCE)
        fallbackReason = (error instanceof Error ? error.message : String(error)).slice(0, 200)
      }
    }
    const viaBrowser = await withTransportLock(() => withRecoveredCollector(async (page) => {
      await warmAkamaiSession(page)
      const result = await run(browserClient(page))
      // Fresh cookies from the browser let the next scan go browserless again.
      await saveSessionCookies(page.context()).catch(() => undefined)
      return result
    }))
    return { ...viaBrowser, ...(fallbackReason ? { fallbackReason } : {}) }
  } finally {
    progress = { ...progress, running: false, label: '' }
  }
}
