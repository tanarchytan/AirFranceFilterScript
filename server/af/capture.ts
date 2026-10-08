import { appendFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { BrowserContext, Request } from 'patchright'

/**
 * Debug recorder: every Air France / KLM identity request the browser makes (the site's
 * own calls included), plus cookie-name snapshots. Values of cookies are never written.
 * Off unless AF_CAPTURE=1. Output: .airfrance-capture.jsonl (gitignored).
 */
const CAPTURE_FILE = resolve('.airfrance-capture.jsonl')
const WATCHED = /airfrance\.|airfranceklm\.com/i
const BODY_LIMIT = 2_000

const write = (entry: Record<string, unknown>): void => {
  void appendFile(CAPTURE_FILE, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`).catch(() => undefined)
}

const describeRequest = (request: Request) => {
  const body = request.postData() ?? undefined
  let operationName: string | undefined
  let variables: unknown
  try {
    const parsed = body ? JSON.parse(body) as { operationName?: string; variables?: unknown } : undefined
    operationName = parsed?.operationName
    variables = parsed?.variables
  } catch { /* not JSON */ }
  const headers = request.headers()
  return {
    method: request.method(),
    url: request.url().slice(0, 300),
    operationName: operationName ?? new URL(request.url()).searchParams.get('operationName') ?? undefined,
    variables,
    headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, k === 'cookie' ? v.split(';').map((c) => c.split('=')[0].trim()) : v])),
  }
}

export const startCapture = (context: BrowserContext): void => {
  if (process.env.AF_CAPTURE !== '1') return
  let lastCookies = ''
  context.on('response', (response) => {
    const request = response.request()
    if (!WATCHED.test(request.url()) || ['image', 'font', 'stylesheet', 'media'].includes(request.resourceType())) return
    void (async () => {
      const isData = /gql|graphql|api|identity|login|token|oauth|sso/i.test(request.url())
      const text = isData ? await response.text().catch(() => '') : ''
      write({ kind: 'response', status: response.status(), ...describeRequest(request), body: text.slice(0, BODY_LIMIT) })
      const cookies = (await context.cookies())
        .filter((cookie) => WATCHED.test(cookie.domain))
        .map((cookie) => `${cookie.domain}|${cookie.name}|${cookie.expires === -1 ? 'session' : 'persistent'}`)
        .sort()
      const signature = cookies.join(',')
      if (signature !== lastCookies) {
        lastCookies = signature
        write({ kind: 'cookies', count: cookies.length, cookies })
      }
    })().catch(() => undefined)
  })
}
