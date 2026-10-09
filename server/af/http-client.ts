import { readFile } from 'node:fs/promises'
import { Impit } from 'impit'
import { sourceCooldowns } from '../source-cooldown.js'
import type { GqlClient } from './gql-client.js'
import { clientRevision } from './hashes.js'
import { graphQlErrorMessage } from './hashcash.js'
import { ORIGIN, SITE_DOMAIN } from './market.js'
import { mergeSavedCookies, SESSION_FILE } from './session-store.js'
import { buildGraphQlBody, siteHeaders } from './transport.js'

/**
 * Browserless Air France client: impit (Chrome TLS/HTTP2 fingerprint) with the cookies the
 * browser saved. Verified live 2026-10-09 for cash calendars, SearchCustomer and hashcash
 * award calendars. Akamai renews its cookies through Set-Cookie, which the jar keeps; when it
 * blocks anyway (HTML challenge) or the login is gone, callers fall back to the browser.
 */
export class SimpleCookieJar {
  private readonly cookies = new Map<string, string>()

  constructor(initial: Array<{ name: string; value: string }> = []) {
    for (const cookie of initial) this.cookies.set(cookie.name, cookie.value)
  }

  setCookie(header: string): void {
    const [pair, ...attributes] = header.split(';')
    const separator = pair.indexOf('=')
    if (separator < 1) return
    const name = pair.slice(0, separator).trim()
    const value = pair.slice(separator + 1).trim()
    const expired = attributes.some((attribute) => {
      const [key, raw = ''] = attribute.split('=').map((part) => part.trim())
      if (/^max-age$/i.test(key)) return Number(raw) <= 0
      if (/^expires$/i.test(key)) return Date.parse(raw) < Date.now()
      return false
    })
    if (expired) {
      this.cookies.delete(name)
    } else {
      this.cookies.set(name, value)
      this.changed.set(name, value)
    }
  }

  /** Cookies changed by the server since the jar was created. */
  readonly changed = new Map<string, string>()

  getCookieString(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ')
  }

  get size(): number {
    return this.cookies.size
  }
}

interface SavedSession {
  revision?: string
  userAgent?: string
  cookies?: Array<{ name: string; value: string; domain: string }>
}

/** undefined when no browser session was saved yet (first run: the browser logs in). */
export const createHttpClient = async (): Promise<GqlClient | undefined> => {
  let saved: SavedSession
  try {
    saved = JSON.parse(await readFile(SESSION_FILE, 'utf8')) as SavedSession
  } catch {
    return undefined
  }
  const jar = new SimpleCookieJar((saved.cookies ?? []).filter((cookie) => cookie.domain.replace(/^\./, '').endsWith(SITE_DOMAIN)))
  if (!jar.size) return undefined
  const revision = saved.revision ?? clientRevision()
  // Fresh TLS/HTTP2 connection per scan: only the first call on a reused connection got through.
  const impit = new Impit({ browser: 'chrome' })
  // Same UA and client hints as the Chrome that earned the Akamai cookies.
  const chromeMajor = /Chrome\/(\d+)/.exec(saved.userAgent ?? '')?.[1]
  const browserHeaders: Record<string, string> = saved.userAgent && chromeMajor
    ? {
      'user-agent': saved.userAgent,
      'sec-ch-ua': `"Chromium";v="${chromeMajor}", "Google Chrome";v="${chromeMajor}", "Not A(Brand";v="99"`,
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
    }
    : {}

  return {
    kind: 'http',
    post: async <T>(operationName: string, hash: string, variables: Record<string, unknown>, options: { withHashcash?: boolean; queryBookingFlow?: string } = {}) => {
      sourceCooldowns.assertAvailable('airfrance', 'Air France')
      const body = buildGraphQlBody(operationName, hash, variables, options.withHashcash ?? false)
      const response = await impit.fetch(`${ORIGIN}/gql/v1?bookingFlow=${options.queryBookingFlow ?? 'LEISURE'}&operationName=${operationName}`, {
        method: 'POST',
        headers: { ...browserHeaders, ...siteHeaders(revision), origin: ORIGIN, referer: `${ORIGIN}/search/advanced`, cookie: jar.getCookieString() },
        body: JSON.stringify(body),
      })
      for (const header of response.headers.getSetCookie?.() ?? []) jar.setCookie(header)
      // Keep Akamai's renewals for the next scan (best effort).
      await mergeSavedCookies([...jar.changed].map(([name, value]) => ({ name, value }))).catch(() => undefined)
      const text = await response.text()
      if (text.trimStart().startsWith('<')) throw new Error(`HTML challenge (HTTP ${response.status})`)
      if (response.status >= 400) throw new Error(`Air France GraphQL ${operationName}: HTTP ${response.status}`)
      const payload = JSON.parse(text) as T & { errors?: Array<{ message?: string; extensions?: { code?: string } }> }
      if (payload.errors?.length) throw new Error(graphQlErrorMessage(payload.errors))
      return payload
    },
  }
}
