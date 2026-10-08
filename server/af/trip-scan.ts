import type { DayFare, ScanPeriod, TripOption } from '../../src/types.js'
import type { LowestFareOffer } from './types.js'
import { addDays } from './variables.js'

/** Pure planning and ranking for the trip scanner (network code lives in trip-scan-run.ts). */
export type TripRanking = 'miles' | 'value'

/** Air France opens award seats about 355 days ahead. */
export const BOOKING_WINDOW_DAYS = 355
/** "Any" stay length still needs a bound for the return calendar. */
export const MAX_ANY_STAY_NIGHTS = 60

const endOfMonth = (isoDate: string, monthsAhead = 0): string => {
  const date = new Date(`${isoDate.slice(0, 7)}-01T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + monthsAhead + 1)
  date.setUTCDate(0)
  return date.toISOString().slice(0, 10)
}

/** Outbound dates to scan: from tomorrow to the end of the chosen period. */
export const periodRange = (period: ScanPeriod, today: string): [string, string] => {
  const from = addDays(today, 1)
  const windowEnd = addDays(today, BOOKING_WINDOW_DAYS)
  const month = Number(today.slice(5, 7))
  const to = period === 'month' ? endOfMonth(today)
    : period === 'quarter' ? endOfMonth(today, 2 - ((month - 1) % 3))
    : period === 'year' ? `${today.slice(0, 4)}-12-31`
    : windowEnd
  return [from, to < windowEnd ? to : windowEnd]
}

/** One DAY calendar request per calendar month keeps every answer complete. */
export const monthChunks = (from: string, to: string): Array<[string, string]> => {
  const chunks: Array<[string, string]> = []
  for (let start = from; start <= to; start = addDays(endOfMonth(start), 1)) {
    const end = endOfMonth(start)
    chunks.push([start, end < to ? end : to])
  }
  return chunks
}

/** One-way calendar rows → priced days (totalPrice is the one-way price for all passengers). */
export const dayFaresFrom = (offers: LowestFareOffer[]): DayFare[] => offers.flatMap((offer) => (
  offer.flightDate && !offer.noFlight && offer.totalPrice != null
    ? [{
      date: offer.flightDate,
      miles: offer.totalPrice,
      ...(offer.totalTaxDetails?.totalPrice != null ? { taxes: offer.totalTaxDetails.totalPrice } : {}),
    }]
    : []
))

const nightsBetween = (from: string, to: string): number => (
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
)

const roundEur = (value: number): number => Math.round(value * 100) / 100

/**
 * Flying Blue prices a return as two one-way awards, so a trip = cheapest outbound day
 * + cheapest return day. Totals are estimates until priced exactly.
 */
export const combineTrips = (
  outbound: DayFare[],
  inbound: DayFare[] | undefined,
  { stayNights, mileValueCents }: { stayNights: number | null; mileValueCents: number },
): TripOption[] => {
  const value = (miles: number, taxes: number) => roundEur(miles * mileValueCents / 100 + taxes)
  if (!inbound) {
    return outbound.map((out) => ({
      outboundDate: out.date,
      outboundMiles: out.miles,
      totalMiles: out.miles,
      totalTaxes: roundEur(out.taxes ?? 0),
      valueEur: value(out.miles, out.taxes ?? 0),
    }))
  }
  const returnsByDate = new Map(inbound.map((fare) => [fare.date, fare]))
  const trips: TripOption[] = []
  for (const out of outbound) {
    const stays = stayNights != null
      ? [stayNights]
      : Array.from({ length: MAX_ANY_STAY_NIGHTS }, (_, index) => index + 1)
    for (const nights of stays) {
      const back = returnsByDate.get(addDays(out.date, nights))
      if (!back) continue
      const totalMiles = out.miles + back.miles
      const totalTaxes = roundEur((out.taxes ?? 0) + (back.taxes ?? 0))
      trips.push({
        outboundDate: out.date,
        returnDate: back.date,
        nights: nightsBetween(out.date, back.date),
        outboundMiles: out.miles,
        returnMiles: back.miles,
        totalMiles,
        totalTaxes,
        valueEur: value(totalMiles, totalTaxes),
      })
    }
  }
  return trips
}

export const rankTrips = (trips: TripOption[], by: TripRanking, limit: number): TripOption[] => [...trips]
  .sort((left, right) => (
    by === 'miles'
      ? left.totalMiles - right.totalMiles || left.totalTaxes - right.totalTaxes
      : left.valueEur - right.valueEur || left.totalMiles - right.totalMiles
  ) || left.outboundDate.localeCompare(right.outboundDate) || (left.returnDate ?? '').localeCompare(right.returnDate ?? ''))
  .slice(0, limit)

/** "Cheapest flight first": best outbound days, each with its cheapest return options. */
export const cheapestOutboundsWithReturns = (
  outbound: DayFare[],
  trips: TripOption[],
  { outboundLimit, returnLimit }: { outboundLimit: number; returnLimit: number },
): Array<{ outbound: DayFare; returns: TripOption[] }> => [...outbound]
  .sort((left, right) => left.miles - right.miles || (left.taxes ?? 0) - (right.taxes ?? 0) || left.date.localeCompare(right.date))
  .slice(0, outboundLimit)
  .map((day) => ({
    outbound: day,
    returns: rankTrips(trips.filter((trip) => trip.outboundDate === day.date && trip.returnDate), 'miles', returnLimit),
  }))
