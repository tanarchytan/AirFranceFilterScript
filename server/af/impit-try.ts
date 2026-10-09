import { readFile } from 'node:fs/promises'
import { Impit } from 'impit'
import { RATLINE_LOWEST_FARE_HASH, SEARCH_CUSTOMER_HASH } from './hashes.js'
import { solveHashcash } from './hashcash.js'
import { MARKET, ORIGIN } from './market.js'
import { SESSION_FILE } from './session-store.js'
import { cashHeaders } from './transport.js'

/**
 * Experiment: can Air France GraphQL be called without a browser, with impit (Chrome TLS /
 * HTTP2 fingerprint) and the cookies Ratline saved from its browser? Tries a cash calendar,
 * the login check, and an award calendar.
 *   pnpm exec tsx server/af/impit-try.ts
 */
const REVISION = process.env.AF_CLIENT_REVISION ?? '52aa181c0c2bbbf8429fc005d8ff15b4555cfd97'
const saved = JSON.parse(await readFile(SESSION_FILE, 'utf8')) as { savedAt: string; cookies: Array<{ name: string; value: string; domain: string }> }
const cookieHeader = saved.cookies
  .filter((cookie) => MARKET.host.endsWith(cookie.domain.replace(/^\./, '')))
  .map((cookie) => `${cookie.name}=${cookie.value}`)
  .join('; ')
console.log(`cookies saved ${saved.savedAt}, ${cookieHeader.split('; ').length} sent`)

const impit = new Impit({ browser: 'chrome' })
const headers = {
  ...cashHeaders,
  'accept-language': MARKET.acceptLanguage,
  'x-aviato-host': MARKET.host,
  'x-client-revision': REVISION,
  'x-ubc-name': 'search',
  origin: ORIGIN,
  referer: `${ORIGIN}/search/advanced`,
  cookie: cookieHeader,
}

const post = async (operationName: string, hash: string, variables: Record<string, unknown>, hashcash: boolean) => {
  const body = {
    operationName,
    variables,
    extensions: {
      ...(hashcash ? { hashcash: solveHashcash(variables) } : {}),
      persistedQuery: { version: 1, sha256Hash: hash },
    },
  }
  const response = await impit.fetch(`${ORIGIN}/gql/v1?bookingFlow=LEISURE&operationName=${operationName}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  })
  const text = await response.text()
  console.log(`${operationName}: HTTP ${response.status} ${text.trimStart().startsWith('<') ? 'HTML (blocked)' : text.slice(0, 220)}`)
}

const leg = (bookingFlow: 'LEISURE' | 'REWARD', first: string, last: string) => ({
  lowestFareOffersRequest: {
    bookingFlow, withUpsellCabins: true, passengers: [{ id: 1, type: 'ADT' }, { id: 2, type: 'ADT' }], commercialCabins: ['ECONOMY'],
    type: 'DAY',
    requestedConnections: [{
      departureDate: first, dateInterval: `${first}/${last}`,
      origin: { type: 'AIRPORT', code: 'AMS' }, destination: { type: 'CITY', code: 'OSA' },
    }],
  },
  activeConnection: 0, searchStateUuid: crypto.randomUUID(), bookingFlow,
})

await post('SharedSearchLowestFareOffersForSearchQuery', RATLINE_LOWEST_FARE_HASH, leg('LEISURE', '2027-01-01', '2027-01-31'), false)
await new Promise((resolve) => setTimeout(resolve, 3_000))
await post('SearchCustomerForSearchQuery', SEARCH_CUSTOMER_HASH, { expand: 'memberships_flyingblue' }, false)
await new Promise((resolve) => setTimeout(resolve, 3_000))
await post('SharedSearchLowestFareOffersForSearchQuery', RATLINE_LOWEST_FARE_HASH, leg('REWARD', '2027-01-01', '2027-01-31'), true)
