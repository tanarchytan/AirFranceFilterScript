import cors from '@fastify/cors'
import Fastify from 'fastify'
import { z } from 'zod'
import type { ExploreMonthItem, FareCalendarItem, MonthlyFareItem, RawOffer, SearchRequest, Station, TripScanRequest } from '../src/types.js'
import {
  confirmFlyingBlueSession,
  exploreCashFares,
  exploreRewardFares,
  FlyingBlueAuthError,
  isFlyingBlueAuthenticated,
  mergeCashAndRewardOffers,
  openFlyingBlueLogin,
  prewarmCollector,
  searchCashOffers,
  searchRewardOffers,
} from './airfrance-api.js'
import { getAirFranceStations } from './airfrance.js'
import { describeAirFranceTransportError } from './af/transport-errors.js'
import { isAllowedOrigin, isLocalHost } from './local-guard.js'
import { scanRewardTrips } from './af/trip-scan-run.js'

const app = Fastify({ logger: true })
await app.register(cors, { origin: (origin, done) => done(null, isAllowedOrigin(origin)) })
app.addHook('onRequest', async (request, reply) => {
  if (!isLocalHost(request.headers.host) || !isAllowedOrigin(request.headers.origin)) {
    return reply.code(403).send({ error: 'Local callers only' })
  }
})

const stationSchema = z.object({
  code: z.string(), cityCode: z.string(), cityName: z.string(), countryName: z.string(),
  displayText: z.string(), stationType: z.string(), isOrigin: z.boolean(), isDestination: z.boolean(),
})

const requestSchema = z.object({
  origin: stationSchema,
  destination: stationSchema,
  tripType: z.enum(['return', 'oneway']).default('return'),
  departureDate: z.string().date(),
  returnDate: z.string().date(),
  flexibleDays: z.number().int().min(0).max(30),
  tripLengthDays: z.number().int().min(1).max(30),
  cabins: z.array(z.enum(['ECONOMY', 'PREMIUM', 'BUSINESS'])).min(1),
  paymentMode: z.enum(['cash', 'miles', 'both']),
  adults: z.number().int().min(1).max(9),
  maxStops: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  maxDurationHours: z.number().min(8).max(72),
  nearbyAirports: z.boolean(),
  separateTickets: z.boolean(),
  longLayover: z.boolean(),
  mileValueCents: z.number().min(0.1).max(10),
})

const scanSchema = z.object({
  origin: stationSchema,
  destination: stationSchema,
  tripType: z.enum(['return', 'oneway']).default('return'),
  adults: z.number().int().min(1).max(9),
  cabins: z.array(z.enum(['ECONOMY', 'PREMIUM', 'BUSINESS'])).min(1),
  period: z.enum(['month', 'quarter', 'year', '12m']),
  stayNights: z.number().int().min(1).max(60).nullable(),
  mileValueCents: z.number().min(0.1).max(10),
})

const exploreSchema = z.object({
  origin: stationSchema,
  destination: stationSchema,
  paymentMode: z.enum(['cash', 'both']).default('both'),
})

const mergeFareCalendars = (cash: FareCalendarItem[], reward: FareCalendarItem[]): FareCalendarItem[] => {
  const merged = new Map<string, FareCalendarItem>()
  for (const item of [...cash, ...reward]) {
    const key = `${item.departureDate}/${item.returnDate}`
    merged.set(key, { ...merged.get(key), ...item, selected: Boolean(merged.get(key)?.selected || item.selected) })
  }
  return [...merged.values()].sort((left, right) => left.departureDate.localeCompare(right.departureDate))
}

const mergeMonthlyCalendars = (cash: MonthlyFareItem[], reward: MonthlyFareItem[]): MonthlyFareItem[] => {
  const merged = new Map<string, MonthlyFareItem>()
  for (const item of [...cash, ...reward]) merged.set(item.month, { ...merged.get(item.month), ...item })
  return [...merged.values()].sort((left, right) => left.month.localeCompare(right.month))
}

const mergeExploreMonths = (cash: ExploreMonthItem[], reward: ExploreMonthItem[]): ExploreMonthItem[] => {
  const merged = new Map<string, ExploreMonthItem>()
  for (const item of [...cash, ...reward]) {
    const current = merged.get(item.month)
    merged.set(item.month, {
      ...current,
      ...item,
      cashTop3: item.cashTop3.length ? item.cashTop3 : current?.cashTop3 ?? [],
      milesTop3: item.milesTop3.length ? item.milesTop3 : current?.milesTop3 ?? [],
    })
  }
  return [...merged.values()].sort((left, right) => left.month.localeCompare(right.month))
}

const isoDateOffset = (days: number): string => {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

const explorationRequest = (origin: Station, destination: Station, paymentMode: 'cash' | 'both'): SearchRequest => ({
  origin,
  destination,
  tripType: 'return',
  departureDate: isoDateOffset(1),
  returnDate: isoDateOffset(11),
  flexibleDays: 0,
  tripLengthDays: 10,
  cabins: ['ECONOMY'],
  paymentMode,
  adults: 1,
  maxStops: 2,
  maxDurationHours: 72,
  nearbyAirports: true,
  separateTickets: false,
  longLayover: false,
  mileValueCents: 1.2,
})

const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

app.get('/api/health', async () => ({ ok: true, service: 'airfrance-rat', time: new Date().toISOString() }))

app.get('/api/auth/status', async (request, reply) => {
  try {
    const authenticated = await isFlyingBlueAuthenticated()
    return { authenticated, service: 'flying-blue' }
  } catch (error) {
    request.log.warn(error, 'Flying Blue auth status check failed')
    return reply.status(503).send({
      authenticated: false,
      error: describeAirFranceTransportError(error),
    })
  }
})

app.post('/api/auth/open', async (request, reply) => {
  try {
    const { url } = await openFlyingBlueLogin()
    return {
      ok: true,
      url,
      message: 'Chrome is open. Log in to Flying Blue, then click “I’m logged in” in Ratline.',
    }
  } catch (error) {
    request.log.warn(error, 'Unable to open Flying Blue login')
    return reply.status(503).send({
      ok: false,
      error: describeAirFranceTransportError(error),
    })
  }
})

app.post('/api/auth/confirm', async (request, reply) => {
  try {
    const session = await confirmFlyingBlueSession()
    if (!session.authenticated) {
      return reply.status(401).send({
        ok: false,
        authenticated: false,
        cookieCount: session.cookieCount,
        error: 'Flying Blue session not found. Finish logging in in Chrome, then try again.',
        detail: session.detail,
      })
    }
    return {
      ok: true,
      authenticated: true,
      cookieCount: session.cookieCount,
      url: session.url,
      message: `Flying Blue session ready (${session.cookieCount} Air France cookies).`,
    }
  } catch (error) {
    request.log.warn(error, 'Unable to confirm Flying Blue session')
    return reply.status(503).send({
      ok: false,
      authenticated: false,
      error: describeAirFranceTransportError(error),
    })
  }
})

app.get('/api/stations', async (request, reply) => {
  const query = z.object({ q: z.string().default('') }).parse(request.query).q.trim()
  let stations
  try {
    stations = await getAirFranceStations()
  } catch (error) {
    request.log.warn(error, 'Air France station reference unavailable')
    return reply.status(503).send({
      source: 'live',
      results: [],
      error: 'The Air France reference service is not responding. No local airport was substituted.',
    })
  }

  const needle = normalized(query)
  const results = stations
    .filter((station) => !needle || normalized(`${station.code} ${station.cityName} ${station.displayText} ${station.countryName}`).includes(needle))
    .sort((a, b) => {
      const exactA = normalized(a.code) === needle || normalized(a.cityName) === needle ? -1 : 0
      const exactB = normalized(b.code) === needle || normalized(b.cityName) === needle ? -1 : 0
      return exactA - exactB || a.cityName.localeCompare(b.cityName, 'en')
    })
    .slice(0, 12)
  return { source: 'live', results }
})

app.post('/api/scan', async (request, reply) => {
  const parsed = scanSchema.safeParse(request.body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return reply.status(400).send({ error: `Invalid scan · ${issue?.path.join('.') || 'parameter'}: ${issue?.message ?? 'bad value'}` })
  }
  try {
    return await scanRewardTrips(parsed.data as TripScanRequest)
  } catch (error) {
    if (error instanceof FlyingBlueAuthError) {
      return reply.status(401).send({ authRequired: true, error: 'Log in to Flying Blue in Chrome, then scan again.' })
    }
    request.log.warn(error, 'Trip scan failed')
    return reply.status(503).send({ error: describeAirFranceTransportError(error) })
  }
})

app.post('/api/explore', async (request, reply) => {
  const parsed = exploreSchema.safeParse(request.body)
  if (!parsed.success) return reply.status(400).send({ error: 'Invalid airports', issues: parsed.error.issues })
  const startedAt = performance.now()
  const searchRequest = explorationRequest(parsed.data.origin as Station, parsed.data.destination as Station, parsed.data.paymentMode)
  const warnings: string[] = []
  let months: ExploreMonthItem[] = []
  let operations: string[] = []
  let cacheHit = false
  let status: 'complete' | 'empty' | 'blocked' | 'auth-required' = 'empty'
  let authRequired = false
  try {
    const cash = await exploreCashFares(searchRequest)
    let rewardMonths: ExploreMonthItem[] = []
    let rewardCacheHit = true
    if (searchRequest.paymentMode === 'both') {
      try {
        const reward = await exploreRewardFares(searchRequest)
        rewardMonths = reward.months
        rewardCacheHit = reward.cacheHit
        operations.push(...reward.operations)
        if (!rewardMonths.length) warnings.push('Air France returned no Miles calendar for this route.')
      } catch (error) {
        if (!(error instanceof FlyingBlueAuthError)) throw error
        authRequired = true
        warnings.push('Flying Blue login required for Miles: a Chrome window has been opened.')
      }
    }
    months = mergeExploreMonths(cash.months, rewardMonths)
    operations.push(...cash.operations)
    operations = [...new Set(operations)]
    cacheHit = cash.cacheHit && rewardCacheHit
    status = months.length ? 'complete' : 'empty'
  } catch (error) {
    request.log.warn(error, 'Air France monthly exploration failed')
    status = error instanceof FlyingBlueAuthError ? 'auth-required' : 'blocked'
    authRequired = error instanceof FlyingBlueAuthError
    warnings.push(error instanceof FlyingBlueAuthError
      ? 'Flying Blue login required: log in in the Chrome window, then search again.'
      : describeAirFranceTransportError(error))
  }
  return {
    requestId: crypto.randomUUID(),
    source: 'live',
    months,
    warnings,
    searchedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - startedAt),
    status,
    authRequired,
    trace: { operations, cacheHit },
  }
})

app.post('/api/search', async (request, reply) => {
  const parsed = requestSchema.safeParse(request.body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const field = issue?.path.join('.') || 'parameter'
    return reply.status(400).send({
      error: `Invalid search · ${field}: ${issue?.message ?? 'invalid value'}`,
      issues: parsed.error.issues,
    })
  }
  const searchRequest = parsed.data as SearchRequest
  const startedAt = performance.now()
  const warnings: string[] = []

  let offers: RawOffer[] = []
  let fareCalendar: FareCalendarItem[] = []
  let monthlyCalendar: MonthlyFareItem[] = []
  let operations: string[] = []
  let cacheHit = false
  let status: 'complete' | 'empty' | 'blocked' | 'auth-required' = 'empty'
  let candidatePairs = 0
  let authRequired = false

  try {
    let cashOffers: RawOffer[] = []
    let rewardOffers: RawOffer[] = []
    const cacheHits: boolean[] = []
    let cashCalendar: FareCalendarItem[] = []
    let rewardCalendar: FareCalendarItem[] = []
    let cashMonthlyCalendar: MonthlyFareItem[] = []
    let rewardMonthlyCalendar: MonthlyFareItem[] = []

    if (searchRequest.paymentMode !== 'miles') {
      const result = await searchCashOffers(searchRequest)
      cashOffers = result.offers
      cashCalendar = result.fareCalendar
      cashMonthlyCalendar = result.monthlyCalendar
      candidatePairs = Math.max(candidatePairs, result.candidatePairs)
      operations.push(...result.operations)
      cacheHits.push(result.cacheHit)
      if (result.warnings?.length) warnings.push(...result.warnings)
    }

    if (searchRequest.paymentMode !== 'cash') {
      try {
        const result = await searchRewardOffers(searchRequest)
        rewardOffers = result.offers
        rewardCalendar = result.fareCalendar
        rewardMonthlyCalendar = result.monthlyCalendar
        candidatePairs = Math.max(candidatePairs, result.candidatePairs)
        operations.push(...result.operations)
        cacheHits.push(result.cacheHit)
        if (result.warnings?.length) warnings.push(...result.warnings)
      } catch (error) {
        if (!(error instanceof FlyingBlueAuthError)) throw error
        if (searchRequest.paymentMode === 'miles') throw error
        authRequired = true
        warnings.push('Euro prices available. Log in to Flying Blue in Chrome for Miles.')
      }
    }

    offers = searchRequest.paymentMode === 'both'
      ? mergeCashAndRewardOffers(cashOffers, rewardOffers)
      : searchRequest.paymentMode === 'miles' ? rewardOffers : cashOffers
    fareCalendar = mergeFareCalendars(cashCalendar, rewardCalendar)
    monthlyCalendar = mergeMonthlyCalendars(cashMonthlyCalendar, rewardMonthlyCalendar)
    operations = [...new Set(operations)]
    cacheHit = cacheHits.length > 0 && cacheHits.every(Boolean)
    status = offers.length ? 'complete' : 'empty'
  } catch (error) {
    if (error instanceof FlyingBlueAuthError) {
      status = 'auth-required'
      authRequired = true
      warnings.push('Flying Blue login required: log in in the Chrome window, then search again.')
    } else {
      request.log.warn(error, 'Live Air France search failed')
      status = 'blocked'
      warnings.push(describeAirFranceTransportError(error))
    }
  }

  return {
    requestId: crypto.randomUUID(),
    source: 'live',
    offers,
    warnings,
    searchedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - startedAt),
    status,
    fareCalendar,
    monthlyCalendar,
    authRequired,
    trace: { catalog: 'airfrance-gql', collector: 'airfrance-gql', cacheHit, operations, candidatePairs },
  }
})

const port = Number(process.env.PORT ?? 8787)
await app.listen({ host: '127.0.0.1', port })
void prewarmCollector().catch((error) => {
  app.log.warn(error, 'Air France collector warm-up failed (will retry on first search)')
})
