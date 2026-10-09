import { appendFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, type Request, type Response } from 'patchright'
import { findBrowserExecutable } from '../af/browser-launch.js'

/**
 * One-off recorder for reverse-engineering finnair.com: opens a visible Chrome with its
 * own profile, you log in to Finnair Plus and run award + cash searches by hand, and
 * every finnair.com page/API exchange lands in .finnair-capture.jsonl (gitignored).
 * Secrets are masked: tokens, keys and cookies keep only a short prefix and their length.
 *   pnpm capture:finnair   (close the Chrome window to stop)
 */
const PROFILE_DIR = resolve(process.env.FINNAIR_BROWSER_PROFILE ?? '.finnair-browser-profile')
const OUT = resolve('.finnair-capture.jsonl')
const WATCHED = /finnair\.com/i
const BODY_LIMIT = 30_000
const SECRET_HEADER = /authorization|oauth|token|api-key|cookie|session|csrf|xsrf/i

const mask = (value: string) => (value.length <= 8 ? '***' : `${value.slice(0, 6)}…(${value.length})`)
const maskHeaders = (headers: Record<string, string>) => Object.fromEntries(
  Object.entries(headers).map(([name, value]) => [name, SECRET_HEADER.test(name) ? mask(value) : value]),
)
const maskBody = (text: string) => text
  .replace(/("(?:access_?token|refresh_?token|id_?token|oauth_?token|token|password|apiKey|api_key)"\s*:\s*")([^"]{9,})"/gi, (_, key: string, value: string) => `${key}${mask(value)}"`)
  .slice(0, BODY_LIMIT)

const write = (entry: Record<string, unknown>) => appendFile(OUT, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`)

const interesting = (request: Request) => WATCHED.test(request.url())
  && ['document', 'xhr', 'fetch'].includes(request.resourceType())

const record = async (response: Response) => {
  const request = response.request()
  if (!interesting(request)) return
  const type = response.headers()['content-type'] ?? ''
  const body = /json|text|html/.test(type) && request.resourceType() !== 'document'
    ? maskBody(await response.text().catch(() => ''))
    : ''
  await write({
    type: request.resourceType(),
    method: request.method(),
    url: request.url(),
    status: response.status(),
    requestHeaders: maskHeaders(await request.allHeaders().catch(() => request.headers())),
    postData: request.postData() ? maskBody(request.postData()!) : undefined,
    contentType: type,
    body,
  })
}

await mkdir(PROFILE_DIR, { recursive: true })
const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  executablePath: await findBrowserExecutable(),
  viewport: null,
  locale: 'en-GB',
  timezoneId: 'Europe/Amsterdam',
  args: ['--no-first-run', '--no-default-browser-check'],
})
context.on('response', (response) => { void record(response).catch(() => undefined) })
const page = context.pages()[0] ?? await context.newPage()
await page.goto('https://www.finnair.com/nl-en')
await write({ type: 'note', text: 'capture started' })
console.log(`Recording finnair.com traffic to ${OUT}. Close the Chrome window when done.`)
await new Promise<void>((done) => context.on('close', () => done()))
await write({ type: 'note', text: 'capture stopped' })
