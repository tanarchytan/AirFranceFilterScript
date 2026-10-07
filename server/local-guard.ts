/**
 * The API drives a logged-in Flying Blue session, so only local callers may use it.
 * Host check blocks DNS rebinding; Origin check blocks other websites (CSRF / CORS).
 */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

export const isLocalHost = (host: string | undefined): boolean => (
  !!host && LOOPBACK.has(host.replace(/:\d+$/, ''))
)

export const isAllowedOrigin = (origin: string | undefined): boolean => {
  if (origin === undefined) return true
  try {
    const { protocol, hostname } = new URL(origin)
    return protocol === 'http:' && LOOPBACK.has(hostname)
  } catch {
    return false
  }
}
