/**
 * Air France point of sale. One place for host, country and language so the
 * transport, login, cookies and station list all talk to the same site.
 * Select with AF_MARKET=nl|fr (fork default: nl).
 */
export interface Market {
  host: string
  country: string
  language: string
  acceptLanguage: string
  locale: string
  timezoneId: string
}

export const MARKETS = {
  fr: { host: 'wwws.airfrance.fr', country: 'FR', language: 'fr', acceptLanguage: 'fr', locale: 'fr-FR', timezoneId: 'Europe/Paris' },
  nl: { host: 'wwws.airfrance.nl', country: 'NL', language: 'en', acceptLanguage: 'en-US', locale: 'en-US', timezoneId: 'Europe/Amsterdam' },
} as const satisfies Record<string, Market>

export type MarketCode = keyof typeof MARKETS

export const resolveMarket = (code: string | undefined): Market => {
  const key = (code ?? 'nl').toLowerCase()
  if (!(key in MARKETS)) throw new Error(`AF_MARKET must be one of ${Object.keys(MARKETS).join(', ')}, got "${code}"`)
  return MARKETS[key as MarketCode]
}

export const MARKET: Market = resolveMarket(process.env.AF_MARKET)
export const ORIGIN = `https://${MARKET.host}`
/** Registrable domain, e.g. airfrance.nl, for cookie and URL matching. */
export const SITE_DOMAIN = MARKET.host.replace(/^wwws\./, '')

/** Pull the live client revision out of the page HTML config (`"revision":"<40 hex>"`). */
export const parseClientRevision = (html: string): string | undefined => (
  /"revision":"([0-9a-f]{40})"/.exec(html)?.[1]
)
