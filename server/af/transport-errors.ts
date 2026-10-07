/** Map Chromium / network failures to actionable English messages. */
import { ORIGIN } from './market.js'

const NETWORK_PATTERN = /ERR_HTTP2_PROTOCOL_ERROR|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_CONNECTION_REFUSED|ERR_TIMED_OUT|ERR_NAME_NOT_RESOLVED|ERR_ADDRESS_UNREACHABLE|ERR_NETWORK_CHANGED|ERR_SSL_|net::ERR_|Air France navigation failed|Timeout|timed out/i

export const isAirFranceNetworkError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error)
  return NETWORK_PATTERN.test(message)
}

export const describeAirFranceTransportError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error)
  if (isAirFranceNetworkError(error)) {
    return [
      'Air France unreachable (ERR_HTTP2 / timeout).',
      'Ratline will reset the browser profile if needed.',
      `If Brave opens ${ORIGIN} but Ratline still fails,`,
      'restart the API, or switch network (4G / VPN).',
    ].join(' ')
  }
  return message.slice(0, 240)
}
