import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, type Request } from 'patchright'
import { findBrowserExecutable } from '../af/browser-launch.js'

/**
 * Experiment: which Finnair award (Avios) calendars answer? Gets the site's own headers from
 * one cash airBounds call (deeplink), then replays airCalendar for a grid of routes and dates,
 * award and cash. If the profile is logged out, log in in the window (waits up to 5 min).
 * Output: .finnair-calendar-try.json (gitignored).
 *   pnpm exec tsx server/finnair/try-calendar.ts
 */
const PROFILE_DIR = resolve(process.env.FINNAIR_BROWSER_PROFILE ?? '.finnair-browser-profile')
const OFFERS = 'https://api.finnair.com/d/fcom/offers-prod/current/api'
const APP_HEADERS = /^(accept|content-type|authorization|x-client-id|x-session-id|traceparent)$/i

const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false, executablePath: await findBrowserExecutable(), viewport: null, locale: 'en-GB',
  timezoneId: 'Europe/Amsterdam', args: ['--no-first-run', '--no-default-browser-check'],
})
const page = context.pages()[0] ?? await context.newPage()
let template: Request | undefined
context.on('request', (request) => {
  if (request.url().startsWith(`${OFFERS}/airBounds`)) template = request
})

const cashLink = `https://www.finnair.com/nl-en/booking/flight-selection?json=${encodeURIComponent(JSON.stringify({
  flights: [{ origin: 'AMS', destination: 'HEL', departureDate: '2026-12-01' }], cabin: 'ECONOMY', adults: 1, c15s: 0, children: 0, infants: 0,
}))}`
await page.goto('https://www.finnair.com/nl-en', { waitUntil: 'domcontentloaded', timeout: 60_000 })
const loginStatus = await page.evaluate(async () => {
  const response = await fetch('https://auth.finnair.com/cas/ssoStatus', { credentials: 'include' }).catch(() => undefined)
  return response ? `${response.status} ${(await response.text()).slice(0, 120)}` : 'unreachable'
})
console.log('ssoStatus:', loginStatus)
// The app only uses a logged-in token after its own login flow; with an active SSO session
// clicking "Log in" completes silently (ux-auth-prod/init -> cas authorize -> loggedIn).
const loginButton = page.getByRole('button', { name: /^\s*log ?in\s*$/i }).first()
if (await loginButton.isVisible({ timeout: 15_000 }).catch(() => false)) {
  await loginButton.click()
  await page.waitForURL(/finnair\.com\/nl-en/, { timeout: 120_000 }).catch(() => undefined)
  await page.waitForTimeout(4_000)
  console.log('clicked Log in, now at', page.url())
} else {
  console.log('no Log in button visible (already logged in?)')
}
await page.goto(cashLink, { waitUntil: 'domcontentloaded', timeout: 60_000 })
for (let i = 0; i < 60 && !template; i++) await page.waitForTimeout(1_000)
if (!template) throw new Error('no airBounds call seen')
const headers = Object.fromEntries(Object.entries(await template.allHeaders()).filter(([name]) => APP_HEADERS.test(name)))

const call = (payload: unknown, flow: 'award' | 'flight') => page.evaluate(async ({ url, headers, payload }) => {
  const response = await fetch(url, { method: 'POST', credentials: 'include', headers, body: JSON.stringify(payload) })
  const text = await response.text()
  let parsed: { status?: string; currency?: string; airCalendars?: Array<Record<string, unknown>>; messages?: Array<{ amadeusResponse?: { messageDetail?: string }; key?: string }> } = {}
  try { parsed = JSON.parse(text) } catch { /* html */ }
  return {
    http: response.status,
    status: parsed.status,
    currency: parsed.currency,
    days: parsed.airCalendars?.length ?? 0,
    sample: parsed.airCalendars?.slice(0, 3),
    message: parsed.messages?.[0]?.amadeusResponse?.messageDetail ?? parsed.messages?.[0]?.key ?? (parsed.status ? undefined : text.slice(0, 120)),
  }
}, { url: `${OFFERS}/airCalendar`, headers: { ...headers, 'x-dd-flow-type': flow }, payload })

const body = (from: string, to: string, date: string, award: boolean, back?: string) => ({
  adults: 2, c15s: 0, cabin: 'ECONOMY', children: 0, infants: 0, isAward: award,
  itinerary: [
    { departureDate: date, departureLocationCode: from, destinationLocationCode: to },
    ...(back ? [{ departureDate: back, departureLocationCode: to, destinationLocationCode: from }] : []),
  ],
  locale: 'en_NL', promoCode: null,
})

const results: Array<Record<string, unknown>> = []
const routes = [['AMS', 'KIX'], ['HEL', 'KIX'], ['HEL', 'NRT']]
const dates = ['2027-01-14', '2027-03-10']
for (const [from, to] of routes) {
  for (const date of dates) {
    for (const award of [true]) {
      const result = await call(body(from, to, date, award), award ? 'award' : 'flight')
      results.push({ from, to, date, award, ...result })
      console.log(`${from}-${to} ${date} ${award ? 'award' : 'cash '} http ${result.http} ${result.status ?? ''} days ${result.days} ${result.message ?? ''}`)
      await page.waitForTimeout(6_000 + Math.random() * 1_500)
    }
  }
}
// One return-trip shape, to see whether the matrix pairs departure x return dates.
const matrix = await call(body('HEL', 'NRT', '2027-01-14', true, '2027-01-30'), 'award')
results.push({ from: 'HEL', to: 'NRT', date: '2027-01-14', back: '2027-01-30', award: true, ...matrix })
console.log('return matrix:', matrix.http, matrix.status, matrix.days, JSON.stringify(matrix.sample))
await writeFile(resolve('.finnair-calendar-try.json'), JSON.stringify({ loginStatus, results }, null, 2))
await context.close()
