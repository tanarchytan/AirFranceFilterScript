import { describe, expect, it } from 'vitest'
import { cheapestOutboundsWithReturns, combineTrips, dayFaresFrom, monthChunks, periodRange, rankTrips } from './trip-scan.js'

describe('periodRange', () => {
  const today = '2026-10-08'
  it('starts tomorrow and ends at the end of the month / quarter / year', () => {
    expect(periodRange('month', today)).toEqual(['2026-10-09', '2026-10-31'])
    expect(periodRange('quarter', today)).toEqual(['2026-10-09', '2026-12-31'])
    expect(periodRange('year', today)).toEqual(['2026-10-09', '2026-12-31'])
    expect(periodRange('quarter', '2027-02-10')).toEqual(['2027-02-11', '2027-03-31'])
  })
  it('caps 12 months at the Air France booking window (355 days)', () => {
    expect(periodRange('12m', today)).toEqual(['2026-10-09', '2027-09-28'])
  })
})

describe('monthChunks', () => {
  it('splits a range on calendar months', () => {
    expect(monthChunks('2026-10-09', '2026-12-05')).toEqual([
      ['2026-10-09', '2026-10-31'], ['2026-11-01', '2026-11-30'], ['2026-12-01', '2026-12-05'],
    ])
  })
})

describe('dayFaresFrom', () => {
  it('keeps priced days, uses the one-way price, skips noFlight and blanks', () => {
    expect(dayFaresFrom([
      { flightDate: '2027-01-13', totalPrice: 60000, totalPriceItinerary: 120000, totalTaxDetails: { totalPrice: 460.28 } },
      { flightDate: '2027-01-14', noFlight: true, totalPrice: 1 },
      { flightDate: '2027-01-15' },
    ])).toEqual([{ date: '2027-01-13', price: 60000, taxes: 460.28 }])
  })
})

describe('combineTrips + rankTrips', () => {
  const out = [
    { date: '2027-01-10', price: 60000, taxes: 400 },
    { date: '2027-01-11', price: 90000, taxes: 100 },
  ]
  const ret = [
    { date: '2027-01-17', price: 60000, taxes: 100 },
    { date: '2027-01-18', price: 50000, taxes: 600 },
    { date: '2027-01-24', price: 70000, taxes: 50 },
  ]

  it('pairs only returns after the outbound, honouring a fixed stay', () => {
    const trips = combineTrips(out, ret, { stayNights: 7, mileValueCents: 1 })
    expect(trips.map((t) => `${t.outboundDate}>${t.returnDate}`)).toEqual(['2027-01-10>2027-01-17', '2027-01-11>2027-01-18'])
    expect(trips[0]).toMatchObject({ nights: 7, totalPrice: 120000, totalTaxes: 500, valueEur: 1700 })
  })

  it('any stay pairs every later return; miles ranking breaks ties on taxes', () => {
    const ranked = rankTrips(combineTrips(out, ret, { stayNights: null, mileValueCents: 1 }), 'price', 3)
    expect(ranked.map((t) => `${t.outboundDate}>${t.returnDate}:${t.totalPrice}`)).toEqual([
      '2027-01-10>2027-01-18:110000', '2027-01-10>2027-01-17:120000', '2027-01-10>2027-01-24:130000',
    ])
  })

  it('value ranking prices miles at the mile value and adds taxes', () => {
    const ranked = rankTrips(combineTrips(out, ret, { stayNights: null, mileValueCents: 1 }), 'value', 1)
    expect(ranked[0]).toMatchObject({ outboundDate: '2027-01-10', returnDate: '2027-01-17', valueEur: 1700 })
  })

  it('one-way scans rank the outbound days on their own', () => {
    const trips = combineTrips(out, undefined, { stayNights: null, mileValueCents: 1 })
    expect(trips).toHaveLength(2)
    expect(trips[0]).toMatchObject({ outboundDate: '2027-01-10', totalPrice: 60000 })
    expect(trips[0].returnDate).toBeUndefined()
  })

  it('lists the cheapest outbound days, each with its cheapest returns', () => {
    const trips = combineTrips(out, ret, { stayNights: null, mileValueCents: 1 })
    const groups = cheapestOutboundsWithReturns(out, trips, { outboundLimit: 1, returnLimit: 2 })
    expect(groups).toHaveLength(1)
    expect(groups[0].outbound).toEqual(out[0])
    expect(groups[0].returns.map((t) => `${t.returnDate}:${t.returnPrice}`)).toEqual(['2027-01-18:50000', '2027-01-17:60000'])
  })

  it('euro fares are their own value (no mile conversion)', () => {
    const trips = combineTrips([{ date: '2027-01-10', price: 500 }], [{ date: '2027-01-17', price: 450 }], { stayNights: 7, mileValueCents: 1.2, currency: 'EUR' })
    expect(trips[0]).toMatchObject({ totalPrice: 950, totalTaxes: 0, valueEur: 950 })
  })
})
