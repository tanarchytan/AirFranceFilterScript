import { randomUUID } from 'node:crypto'
import type { Page } from 'patchright'
import type { SearchRequest } from '../../src/types.js'
import { navigateAirFrance, refreshCollectorPage } from './browser.js'
import {
  COLLECTOR_PAGE,
  CONTEXT_PASSENGERS_HASH,
  CREATE_SEARCH_CONTEXT_HASH,
  SEARCH_CUSTOMER_HASH,
} from './hashes.js'
import { FlyingBlueAuthError } from './hashcash.js'
import { silentRelogin } from './auth-login.js'
import { saveSessionCookies } from './session-store.js'
import type { GqlClient } from './gql-client.js'
import type {
  CreateSearchContextPayload,
  RewardSession,
  SearchCustomerPayload,
  TravelCompanion,
} from './types.js'
import { contextPassengersVariables } from './variables.js'

/** No fixed revision here: headers read the live one per call (it is captured after startup). */
export const rewardTransportOptions = {
  withHashcash: true,
  queryBookingFlow: 'LEISURE' as const,
  useRewardHeaders: true,
}

const normalizeTravelers = (raw: unknown): Array<{ travelerKey?: number; travelerSource?: string }> => {
  if (Array.isArray(raw)) return raw
  if (!raw || typeof raw !== 'object') return []
  const record = raw as Record<string, unknown>
  if (Array.isArray(record.nodes)) return record.nodes as Array<{ travelerKey?: number; travelerSource?: string }>
  if (Array.isArray(record.edges)) {
    return record.edges.flatMap((edge) => {
      const node = (edge as { node?: { travelerKey?: number; travelerSource?: string } })?.node
      return node ? [node] : []
    })
  }
  if ('travelerKey' in record) return [record as { travelerKey?: number; travelerSource?: string }]
  return []
}

const companionsFromContext = (travelers: unknown, adults: number): TravelCompanion[] => {
  const usable = normalizeTravelers(travelers).filter((traveler) => traveler.travelerKey != null)
  if (!usable.length) {
    throw new FlyingBlueAuthError(
      'No Flying Blue traveller in the profile. Run one Miles search on airfrance.fr first, then try again.',
    )
  }
  return usable.slice(0, adults).map((traveler, index) => ({
    passengerId: index + 1,
    travelerKey: Number(traveler.travelerKey),
    travelerSource: traveler.travelerSource ?? 'PROFILE',
  }))
}

const ensureCollectorPage = async (page: Page): Promise<void> => {
  if (page.url().includes('/search/')) return
  await navigateAirFrance(page, COLLECTOR_PAGE, 1_500)
}

/** SearchCustomer must name a customer; throws FlyingBlueAuthError otherwise. */
const requireCustomer = async (client: GqlClient): Promise<void> => {
  try {
    const payload = await client.post<SearchCustomerPayload>(
      'SearchCustomerForSearchQuery',
      SEARCH_CUSTOMER_HASH,
      { expand: 'memberships_flyingblue' },
      { withHashcash: false, useRewardHeaders: true },
    )
    if (!payload.data || Object.values(payload.data).every((value) => value == null)) {
      throw new FlyingBlueAuthError()
    }
    // Best effort: refresh the saved login so it survives the next API restart.
    if (client.page) await saveSessionCookies(client.page.context()).catch(() => undefined)
  } catch (error) {
    if (error instanceof FlyingBlueAuthError) throw error
    const message = error instanceof Error ? error.message : String(error)
    if (/401|not authenticated|Flying Blue|CustomerAPI/i.test(message)) {
      throw new FlyingBlueAuthError(message)
    }
    throw error
  }
}

/** Auth + CreateSearchContext traveler keys + ContextPassengers. */
export const prepareRewardSession = async (
  client: GqlClient,
  request: SearchRequest,
): Promise<RewardSession> => {
  const searchStateUuid = randomUUID()
  const page = client.page
  if (page) await ensureCollectorPage(page)
  try {
    await requireCustomer(client)
  } catch (error) {
    // Expired Air France session: one silent single-sign-on round trip (browser only), then retry once.
    if (!(error instanceof FlyingBlueAuthError) || !page || !await silentRelogin(page)) throw error
    await requireCustomer(client)
  }

  let context: CreateSearchContextPayload
  try {
    context = await client.post<CreateSearchContextPayload>(
      'SharedSearchCreateSearchContextForSearchQuery',
      CREATE_SEARCH_CONTEXT_HASH,
      { searchStateUuid },
      { withHashcash: false, useRewardHeaders: true },
    )
  } catch (error) {
    if (!page) throw error
    await refreshCollectorPage(page)
    context = await client.post<CreateSearchContextPayload>(
      'SharedSearchCreateSearchContextForSearchQuery',
      CREATE_SEARCH_CONTEXT_HASH,
      { searchStateUuid },
      rewardTransportOptions,
    )
  }
  const companions = companionsFromContext(
    context.data?.createSearchContext?.possibleTravelersFromProfile,
    request.adults,
  )

  await client.post(
    'SharedSearchContextPassengersForSearchQuery',
    CONTEXT_PASSENGERS_HASH,
    contextPassengersVariables(request, searchStateUuid, 'REWARD', companions),
    rewardTransportOptions,
  )
  return { searchStateUuid, companions }
}
