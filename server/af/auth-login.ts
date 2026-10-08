import type { Page } from 'patchright'
import { navigateAirFrance, withRecoveredCollector, withTransportLock } from './browser.js'
import {
  clientRevision,
  COLLECTOR_PAGE,
  SEARCH_CUSTOMER_HASH,
} from './hashes.js'
import { FlyingBlueAuthError } from './hashcash.js'
import { ORIGIN } from './market.js'
import { saveSessionCookies } from './session-store.js'
import { postGraphQl } from './transport.js'
import type { SearchCustomerPayload } from './types.js'

/** Air France account gateway — redirects to KLM IdP / OTP when needed. */
export const FLYING_BLUE_LOGIN_URL = `${ORIGIN}/identification`

let lastCustomerPayload = ''

const probeCustomer = async (page: Page): Promise<boolean> => {
  const payload = await postGraphQl<SearchCustomerPayload>(
    page,
    'SearchCustomerForSearchQuery',
    SEARCH_CUSTOMER_HASH,
    { expand: 'memberships_flyingblue' },
    { withHashcash: false, useRewardHeaders: true, revision: clientRevision() },
  )
  lastCustomerPayload = JSON.stringify(payload.data ?? null)
  const authenticated = Boolean(payload.data && !Object.values(payload.data).every((value) => value == null))
  // Best effort: a failed write only means logging in again after the next restart.
  if (authenticated) await saveSessionCookies(page.context()).catch(() => undefined)
  return authenticated
}

const restoreCollectorPage = async (page: Page): Promise<void> => {
  if (page.url().includes('/search/')) return
  await navigateAirFrance(page, COLLECTOR_PAGE, 1_200)
}

export const openFlyingBlueLoginOnPage = async (page: Page): Promise<string> => {
  await page.bringToFront().catch(() => undefined)
  await navigateAirFrance(page, FLYING_BLUE_LOGIN_URL, 1_200)
  await page.bringToFront().catch(() => undefined)
  return page.url()
}

/** Open (or focus) Chrome on the Air France login page for Flying Blue. */
export const openFlyingBlueLogin = async (): Promise<{ url: string }> => withTransportLock(async () => (
  withRecoveredCollector(async (page) => ({ url: await openFlyingBlueLoginOnPage(page) }))
))

export const isFlyingBlueAuthenticated = async (): Promise<boolean> => withTransportLock(async () => (
  withRecoveredCollector(async (page) => {
    try {
      await restoreCollectorPage(page)
      return await probeCustomer(page)
    } catch (error) {
      if (error instanceof FlyingBlueAuthError) return false
      const message = error instanceof Error ? error.message : String(error)
      if (/401|not authenticated|Flying Blue|CustomerAPI/i.test(message)) return false
      throw error
    }
  })
))

/**
 * After the user signs in inside Chrome, verify SearchCustomer and keep the
 * session cookies already stored on the collector browser context/profile.
 */
export const confirmFlyingBlueSession = async (): Promise<{
  authenticated: boolean
  cookieCount: number
  url: string
  /** Why Air France said no, when it did (shown to the user instead of a bare "not found"). */
  detail?: string
}> => withTransportLock(async () => (
  withRecoveredCollector(async (page) => {
    await page.bringToFront().catch(() => undefined)
    await restoreCollectorPage(page)
    const cookies = await page.context().cookies(ORIGIN)
    const cookieCount = cookies.filter((cookie) => /airfrance/i.test(cookie.domain)).length
    try {
      const authenticated = await probeCustomer(page)
      return { authenticated, cookieCount, url: page.url(), ...(authenticated ? {} : { detail: `SearchCustomer returned ${lastCustomerPayload.slice(0, 400)}` }) }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (error instanceof FlyingBlueAuthError || /401|not authenticated|Flying Blue|CustomerAPI/i.test(message)) {
        return { authenticated: false, cookieCount, url: page.url(), detail: message.slice(0, 300) }
      }
      throw error
    }
  })
))
