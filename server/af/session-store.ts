import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { BrowserContext, Cookie } from 'patchright'
import { clientRevision } from './hashes.js'
import { SITE_DOMAIN } from './market.js'

/**
 * Flying Blue's login cookies (aviato_sso_*) are session cookies, so Chrome drops
 * them whenever Ratline's browser closes, including on every API restart. Keep a
 * local copy (gitignored via `.airfrance-session*.json`) and put them back on launch.
 * The file holds a live login session: it never leaves this machine.
 */
export const SESSION_FILE = resolve(process.env.AF_SESSION_FILE ?? '.airfrance-session.json')

const isAirFranceCookie = (domain: string): boolean => {
  const host = domain.toLowerCase()
  return host.endsWith(SITE_DOMAIN) || host.endsWith('airfranceklm.com')
}

export const cookiesToSave = (cookies: Cookie[]): Cookie[] => (
  cookies.filter((cookie) => isAirFranceCookie(cookie.domain))
)

/** A persistent profile already keeps expiring cookies; only session cookies are missing. */
export const cookiesToRestore = (
  cookies: Cookie[],
  { persistentProfile, nowSeconds }: { persistentProfile: boolean; nowSeconds: number },
): Cookie[] => cookies.filter((cookie) => (
  cookie.expires === -1 || (!persistentProfile && cookie.expires > nowSeconds)
))

/** Identity of the session-only cookies; '' when there are none (not logged in yet). */
export const sessionSignature = (cookies: Cookie[]): string => cookiesToSave(cookies)
  .filter((cookie) => cookie.expires === -1)
  .map((cookie) => `${cookie.domain}|${cookie.name}|${cookie.value}`)
  .sort()
  .join('\n')

/** Every Air France cookie value; Akamai rotates _abck / bm_sv as the browser runs. */
export const cookieJarSignature = (cookies: Cookie[]): string => cookiesToSave(cookies)
  .map((cookie) => `${cookie.domain}|${cookie.name}|${cookie.value}`)
  .sort()
  .join('\n')

const WATCH_INTERVAL_MS = 3_000

/**
 * Save the moment a login lands, so the user can close Chrome right after logging in.
 * Session cookies cannot be read once the browser is gone, hence polling while it is open.
 */
export const watchSessionCookies = (context: BrowserContext): void => {
  let lastSignature = ''
  const timer = setInterval(() => {
    void context.cookies().then(async (cookies) => {
      // Save on any change, not just the login: the browserless client needs Akamai
      // cookies the browser renewed moments ago (they stop working ~10-20 min later).
      const signature = cookieJarSignature(cookies)
      if (!signature || signature === lastSignature) return
      await saveSessionCookies(context)
      lastSignature = signature
    }).catch(() => undefined) // context closing mid-poll; the close handler stops the timer
  }, WATCH_INTERVAL_MS)
  timer.unref()
  context.on('close', () => clearInterval(timer))
}

export const saveSessionCookies = async (context: BrowserContext): Promise<void> => {
  const cookies = cookiesToSave(await context.cookies())
  if (!cookies.length) return
  // Revision and user agent let the browserless client look like the browser that made the
  // cookies (Akamai ties _abck to the browser that earned it).
  const page = context.pages()[0]
  const userAgent = page ? await page.evaluate(() => navigator.userAgent).catch(() => undefined) : undefined
  await writeFile(SESSION_FILE, JSON.stringify({ savedAt: new Date().toISOString(), revision: clientRevision(), userAgent, cookies }), { mode: 0o600 })
}

/** Fold cookie updates the browserless client received back into the saved session. */
export const mergeSavedCookies = async (updates: Array<{ name: string; value: string }>): Promise<void> => {
  if (!updates.length) return
  const saved = JSON.parse(await readFile(SESSION_FILE, 'utf8')) as { cookies?: Cookie[] }
  const byName = new Map(updates.map((cookie) => [cookie.name, cookie.value]))
  const cookies = (saved.cookies ?? []).map((cookie) => (
    cookie.domain.replace(/^\./, '').endsWith(SITE_DOMAIN) && byName.has(cookie.name) ? { ...cookie, value: byName.get(cookie.name)! } : cookie
  ))
  await writeFile(SESSION_FILE, JSON.stringify({ ...saved, cookies }), { mode: 0o600 })
}

export const restoreSessionCookies = async (
  context: BrowserContext,
  persistentProfile: boolean,
): Promise<number> => {
  let saved: { cookies?: Cookie[] }
  try {
    saved = JSON.parse(await readFile(SESSION_FILE, 'utf8')) as { cookies?: Cookie[] }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw error
  }
  const cookies = cookiesToRestore(saved.cookies ?? [], { persistentProfile, nowSeconds: Date.now() / 1000 })
  if (cookies.length) await context.addCookies(cookies)
  return cookies.length
}
