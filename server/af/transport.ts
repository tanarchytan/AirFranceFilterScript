import type { Page } from 'patchright'
import { refreshCollectorPage } from './browser.js'
import {
  BATCH_CONCURRENCY,
  BATCH_SPACING_MS,
  clientRevision,
  ENDPOINT,
  ENDPOINT_PATH,
  MAX_FETCH_RETRIES,
  RETRY_BACKOFF_MS,
  SAFE_OPERATION,
} from './hashes.js'
import { graphQlErrorMessage, solveHashcash } from './hashcash.js'
import { markSessionWarm } from './session-state.js'
import { MARKET } from './market.js'
import { isBlockError, sourceCooldowns } from '../source-cooldown.js'
import type { BookingFlow } from './types.js'

export interface GraphQlBody {
  operationName: string
  variables: Record<string, unknown>
  extensions: {
    hashcash?: ReturnType<typeof solveHashcash>
    persistedQuery: { version: number; sha256Hash: string }
  }
}

interface FetchResult {
  ok: boolean
  status?: number
  data?: unknown
  error?: string
}

/**
 * The live airfrance.nl client names the real operation in the URL; the .nl gateway
 * answers {"data":{}} when the URL names a different one. AF_SPOOF_OPERATION=1 restores
 * the old FilterScript behaviour (always the lowest-fare name) for airfrance.fr.
 */
const urlOperation = (operationName: string): string => (
  process.env.AF_SPOOF_OPERATION === '1' ? SAFE_OPERATION : operationName
)

const spoofedPath = (queryBookingFlow: BookingFlow, operationName: string): string => (
  `${ENDPOINT_PATH}?bookingFlow=${queryBookingFlow}&operationName=${urlOperation(operationName)}`
)

const spoofedAbsolute = (queryBookingFlow: BookingFlow, operationName: string): string => (
  `${ENDPOINT}?bookingFlow=${queryBookingFlow}&operationName=${urlOperation(operationName)}`
)

/** Market headers every Air France GQL call needs (missing ones → OFA/TECHNICAL/MISSING_HEADER). */
export const cashHeaders = {
  accept: 'application/json, text/plain, */*',
  'content-type': 'application/json',
  'afkl-travel-country': MARKET.country,
  'afkl-travel-host': 'AF',
  'afkl-travel-language': MARKET.language,
  'afkl-travel-market': MARKET.country,
  country: MARKET.country,
  language: MARKET.language,
} as const

const rewardHeaders = (revision: string) => ({
  ...cashHeaders,
  'accept-language': MARKET.acceptLanguage,
  'x-aviato-host': MARKET.host,
  'x-client-revision': revision,
  'x-ubc-name': 'search',
})

/** FilterScript page-context fetch (relative URL). */
const evaluatePageFetch = async (
  page: Page,
  body: GraphQlBody,
  options: { queryBookingFlow?: BookingFlow; useRewardHeaders?: boolean; revision?: string },
): Promise<FetchResult> => {
  const queryBookingFlow = options.queryBookingFlow ?? 'LEISURE'
  // The site sends the aviato/revision headers on every call; without them airfrance.nl
  // answers {"data":{}} (airfrance.fr tolerated their absence for cash).
  const headers = rewardHeaders(options.revision ?? clientRevision())

  return page.evaluate(async ({ url, hdrs, payload, retries, backoff }) => {
    for (let attempt = 0; attempt < retries; attempt += 1) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: hdrs,
          body: JSON.stringify(payload),
        })
        const text = await response.text()
        if (text.trimStart().startsWith('<')) {
          return { ok: false, status: response.status, error: `HTML challenge (HTTP ${response.status})` }
        }
        return { ok: true, status: response.status, data: JSON.parse(text) }
      } catch (error) {
        if (attempt < retries - 1) {
          await new Promise((resolve) => setTimeout(resolve, backoff * (attempt + 1)))
          continue
        }
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
    return { ok: false, error: 'fetch retries exhausted' }
  }, {
    url: spoofedPath(queryBookingFlow, body.operationName),
    hdrs: headers,
    payload: body,
    retries: MAX_FETCH_RETRIES,
    backoff: RETRY_BACKOFF_MS,
  })
}

/** Iframe-native fetch fallback (absolute URL). */
const evaluateIframeFetch = async (
  page: Page,
  body: GraphQlBody,
  options: { queryBookingFlow?: BookingFlow; useRewardHeaders?: boolean; revision?: string },
): Promise<FetchResult> => {
  const queryBookingFlow = options.queryBookingFlow ?? 'LEISURE'
  // The site sends the aviato/revision headers on every call; without them airfrance.nl
  // answers {"data":{}} (airfrance.fr tolerated their absence for cash).
  const headers = rewardHeaders(options.revision ?? clientRevision())

  return page.evaluate(async ({ url, hdrs, payload, retries, backoff }) => {
    const frame = document.createElement('iframe')
    frame.hidden = true
    document.documentElement.append(frame)
    try {
      const nativeFetch = frame.contentWindow?.fetch.bind(frame.contentWindow)
      if (!nativeFetch) return { ok: false, error: 'Native browser fetch is unavailable' }
      for (let attempt = 0; attempt < retries; attempt += 1) {
        try {
          const response = await nativeFetch(url, {
            method: 'POST',
            credentials: 'include',
            headers: hdrs,
            body: JSON.stringify(payload),
          })
          const text = await response.text()
          if (text.trimStart().startsWith('<')) {
            return { ok: false, status: response.status, error: `HTML challenge (HTTP ${response.status})` }
          }
          return { ok: true, status: response.status, data: JSON.parse(text) }
        } catch (error) {
          if (attempt < retries - 1) {
            await new Promise((resolve) => setTimeout(resolve, backoff * (attempt + 1)))
            continue
          }
          return { ok: false, error: error instanceof Error ? error.message : String(error) }
        }
      }
      return { ok: false, error: 'fetch retries exhausted' }
    } finally {
      frame.remove()
    }
  }, {
    url: spoofedAbsolute(queryBookingFlow, body.operationName),
    hdrs: headers,
    payload: body,
    retries: MAX_FETCH_RETRIES,
    backoff: RETRY_BACKOFF_MS,
  })
}

export const evaluateFetch = async (
  page: Page,
  body: GraphQlBody,
  options: { queryBookingFlow?: BookingFlow; useRewardHeaders?: boolean; revision?: string } = {},
): Promise<FetchResult> => {
  // Prefer FilterScript page fetch; only fall back to iframe-native on non-403 failures.
  const pageResult = await evaluatePageFetch(page, body, options)
  if (pageResult.ok || pageResult.status === 403) return pageResult
  return evaluateIframeFetch(page, body, options)
}

export const buildGraphQlBody = (
  operationName: string,
  persistedQueryHash: string,
  variables: Record<string, unknown>,
  withHashcash = false,
): GraphQlBody => ({
  operationName,
  variables,
  extensions: {
    ...(withHashcash ? { hashcash: solveHashcash(variables) } : {}),
    persistedQuery: { version: 1, sha256Hash: persistedQueryHash },
  },
})

export const postGraphQl = async <T>(
  page: Page,
  operationName: string,
  persistedQueryHash: string,
  variables: Record<string, unknown>,
  options: {
    withHashcash?: boolean
    queryBookingFlow?: BookingFlow
    useRewardHeaders?: boolean
    revision?: string
  } = {},
): Promise<T> => {
  const body = buildGraphQlBody(
    operationName,
    persistedQueryHash,
    variables,
    options.withHashcash ?? false,
  )
  const result = await evaluateFetch(page, body, options)
  if (!result.ok) throw new Error(`Air France GraphQL ${operationName}: ${result.error ?? 'fetch failed'}`)
  if (result.status != null && result.status >= 400) {
    throw new Error(`Air France GraphQL ${operationName}: HTTP ${result.status}`)
  }
  const payload = result.data as T & { errors?: Array<{ message?: string; extensions?: { code?: string } }> }
  if (payload?.errors?.length) throw new Error(graphQlErrorMessage(payload.errors))
  markSessionWarm()
  return payload
}

export const postGraphQlWithRetry = async <T>(
  page: Page,
  operationName: string,
  persistedQueryHash: string,
  variables: Record<string, unknown>,
  options: Parameters<typeof postGraphQl>[4] = {},
): Promise<T> => {
  sourceCooldowns.assertAvailable('airfrance', 'Air France')
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await postGraphQl<T>(page, operationName, persistedQueryHash, variables, options)
      sourceCooldowns.recordSuccess('airfrance')
      return result
    } catch (error) {
      lastError = error
      await refreshCollectorPage(page)
      await page.waitForTimeout(4_000 * (attempt + 1))
    }
  }
  // Still blocked after reloads: stop asking for a while instead of extending the block.
  if (isBlockError(lastError)) sourceCooldowns.recordBlock('airfrance')
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

const runBatchWorkers = async <T>(
  page: Page,
  bodies: GraphQlBody[],
  options: { queryBookingFlow?: BookingFlow; useRewardHeaders?: boolean; revision?: string },
): Promise<Array<{ ok: boolean; data?: T; error?: string }>> => {
  const results = new Array<{ ok: boolean; data?: T; error?: string }>(bodies.length)
  let next = 0
  const worker = async () => {
    while (next < bodies.length) {
      const index = next
      next += 1
      if (index > 0) await page.waitForTimeout(BATCH_SPACING_MS)
      const result = await evaluateFetch(page, bodies[index], options)
      results[index] = {
        ok: result.ok,
        data: result.data as T | undefined,
        error: result.error,
      }
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(BATCH_CONCURRENCY, bodies.length) },
    () => worker(),
  ))
  return results
}

/** Parallel batch via FilterScript fetch, with warm-up + refresh retry. */
export const postGraphQlBatch = async <T>(
  page: Page,
  bodies: GraphQlBody[],
  options: { queryBookingFlow?: BookingFlow; useRewardHeaders?: boolean; revision?: string } = {},
): Promise<Array<{ ok: boolean; data?: T; error?: string }>> => {
  if (!bodies.length) return []

  const first = await evaluateFetch(page, bodies[0], options)
  if (!first.ok) {
    await refreshCollectorPage(page)
    const retriedFirst = await evaluateFetch(page, bodies[0], options)
    if (!retriedFirst.ok) {
      return bodies.map((_, index) => (
        index === 0
          ? { ok: false, error: retriedFirst.error }
          : { ok: false, error: 'skipped after warm-up failure' }
      ))
    }
    if (bodies.length === 1) return [{ ok: true, data: retriedFirst.data as T }]
    const rest = await runBatchWorkers<T>(page, bodies.slice(1), options)
    return [{ ok: true, data: retriedFirst.data as T }, ...rest]
  }

  if (bodies.length === 1) return [{ ok: true, data: first.data as T }]
  const rest = await runBatchWorkers<T>(page, bodies.slice(1), options)
  const results = [{ ok: true, data: first.data as T }, ...rest]
  const failedIdx = results.flatMap((result, index) => (result.ok ? [] : [index]))
  if (!failedIdx.length) return results

  await refreshCollectorPage(page)
  for (const index of failedIdx) {
    const retried = await evaluateFetch(page, bodies[index], options)
    results[index] = {
      ok: retried.ok,
      data: retried.data as T | undefined,
      error: retried.error,
    }
  }
  return results
}
