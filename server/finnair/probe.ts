import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, type Request } from 'patchright'
import { findBrowserExecutable } from '../af/browser-launch.js'

/**
 * Discovery run for the Finnair adapter. Opens finnair.com in the Finnair profile; you log in
 * and run an award (Avios) search by hand, ideally opening the site's price calendar. The probe
 * watches the site's own offers-prod calls (airBounds, airCalendar), then replays them with the
 * site's headers to see what Akamai lets through. Findings: .finnair-probe.json (gitignored,
 * secrets masked) and .finnair-probe.png (last screen).
 *   pnpm exec tsx server/finnair/probe.ts
 */
const PROFILE_DIR = resolve(process.env.FINNAIR_BROWSER_PROFILE ?? '.finnair-browser-profile')
const OFFERS = 'https://api.finnair.com/d/fcom/offers-prod/current/api'
const SECRET = /authorization|oauth|token|api-key|cookie|session|csrf|xsrf/i
/** Headers Finnair's own code sets; the browser adds the rest (cookies, UA, sec-ch) itself. */
const APP_HEADERS = /^(accept|content-type|authorization|x-client-id|x-session-id|x-dd-flow-type|traceparent)$/i
const WAIT_MS = 10 * 60_000
const mask = (value: string) => (value.length <= 8 ? '***' : `${value.slice(0, 6)}…(${value.length})`)

const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false, executablePath: await findBrowserExecutable(), viewport: null, locale: 'en-GB',
  timezoneId: 'Europe/Amsterdam', args: ['--no-first-run', '--no-default-browser-check'],
})
const page = context.pages()[0] ?? await context.newPage()

interface OffersCall { path: string; status: number; request: Request; requestBody: Record<string, unknown>; body: string; native: boolean }
const calls: OffersCall[] = []
let replaying = false
context.on('response', (response) => {
  const request = response.request()
  if (!request.url().startsWith(OFFERS)) return
  const native = !replaying
  void response.text().then((body) => {
    let requestBody: Record<string, unknown> = {}
    try { requestBody = JSON.parse(request.postData() ?? '{}') } catch { /* not JSON */ }
    calls.push({ path: new URL(request.url()).pathname.split('/').pop() ?? '', status: response.status(), request, requestBody, body, native })
  }).catch(() => undefined)
})

const isAwardCall = (call: OffersCall) => /award|points|avios/i.test(JSON.stringify(call.requestBody)) || /totalPoints|"points"/.test(call.body)

await page.goto('https://www.finnair.com/nl-en', { waitUntil: 'domcontentloaded', timeout: 60_000 })
console.log('In the Chrome window: log in to Finnair Plus, search AMS -> Osaka (KIX) with Avios, 2 adults,')
console.log('then open the price calendar on the results page if there is one. Waiting up to 10 minutes.')
const deadline = Date.now() + WAIT_MS
let settleUntil = 0
while (Date.now() < deadline) {
  await page.waitForTimeout(1_000)
  const award = calls.filter((call) => call.native && isAwardCall(call))
  if (award.some((call) => call.path === 'airCalendar')) break
  // Give the user 60 s after the first award result to open the calendar.
  if (award.length && !settleUntil) settleUntil = Date.now() + 60_000
  if (settleUntil && Date.now() > settleUntil) break
}
await page.screenshot({ path: resolve('.finnair-probe.png') }).catch(() => undefined)

const replay = async (template: Request, path: string, body: unknown) => {
  const headers = Object.fromEntries(Object.entries(await template.allHeaders()).filter(([name]) => APP_HEADERS.test(name)))
  replaying = true
  try {
    return await page.evaluate(async ({ url, headers, payload }) => {
      const response = await fetch(url, { method: 'POST', credentials: 'include', headers, body: JSON.stringify(payload) })
      return { status: response.status, text: await response.text() }
    }, { url: `${OFFERS}/${path}`, headers, payload: body })
  } finally {
    replaying = false
  }
}

const native = calls.filter((call) => call.native)
const report: Record<string, unknown> = {
  nativeCalls: await Promise.all(native.map(async (call) => ({
    path: call.path,
    status: call.status,
    award: isAwardCall(call),
    requestHeaders: Object.fromEntries(Object.entries(await call.request.allHeaders()).map(([k, v]) => [k, SECRET.test(k) ? mask(v) : v])),
    requestBody: call.requestBody,
    responseHead: call.body.slice(0, 2_000),
  }))),
}

// Replays: the newest native award call of each kind, unchanged, to test what Akamai allows.
const replays: Record<string, unknown> = {}
for (const path of ['airCalendar', 'airBounds']) {
  const template = [...native].reverse().find((call) => call.path === path && isAwardCall(call))
    ?? [...native].reverse().find((call) => call.path === path)
  if (!template) continue
  const result = await replay(template.request, path, template.requestBody)
  replays[path] = { status: result.status, head: result.text.slice(0, 400) }
  console.log(`replay ${path}: HTTP ${result.status}`)
}
report.replays = replays
console.log('native calls:', native.map((call) => `${call.status} ${call.path}${isAwardCall(call) ? ' (award)' : ''}`).join(', ') || 'none')
await writeFile(resolve('.finnair-probe.json'), JSON.stringify(report, null, 2))
await context.close()
