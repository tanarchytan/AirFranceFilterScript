import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { BrowserContext, Cookie } from 'patchright'
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

const WATCH_INTERVAL_MS = 3_000

/**
 * Save the moment a login lands, so the user can close Chrome right after logging in.
 * Session cookies cannot be read once the browser is gone, hence polling while it is open.
 */
export const watchSessionCookies = (context: BrowserContext): void => {
  let lastSignature = ''
  const timer = setInterval(() => {
    void context.cookies().then(async (cookies) => {
      const signature = sessionSignature(cookies)
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
  await writeFile(SESSION_FILE, JSON.stringify({ savedAt: new Date().toISOString(), cookies }), { mode: 0o600 })
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
