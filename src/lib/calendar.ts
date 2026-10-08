/** Month grids and price colouring for the scan calendars. Dates are ISO yyyy-mm-dd (UTC). */

const iso = (date: Date) => date.toISOString().slice(0, 10)

/** Weeks of a month, Monday first; null pads the days outside the month. */
export const monthGrid = (month: string): Array<Array<string | null>> => {
  const first = new Date(`${month}-01T00:00:00Z`)
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  const lead = (first.getUTCDay() + 6) % 7
  const cells: Array<string | null> = Array.from({ length: lead }, () => null)
  for (let day = 1; day <= days; day += 1) {
    cells.push(iso(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), day))))
  }
  while (cells.length % 7) cells.push(null)
  return Array.from({ length: cells.length / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7))
}

export const monthsBetween = (from: string, to: string): string[] => {
  const months: string[] = []
  const cursor = new Date(`${from.slice(0, 7)}-01T00:00:00Z`)
  while (iso(cursor).slice(0, 7) <= to.slice(0, 7)) {
    months.push(iso(cursor).slice(0, 7))
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  return months
}

export type PriceTier = 'low' | 'mid' | 'high'

/** Cheapest third green, middle amber, dearest third red, relative to the visible prices. */
export const priceTier = (price: number, prices: number[]): PriceTier => {
  const sorted = [...new Set(prices)].sort((left, right) => left - right)
  if (sorted.length < 2 || price <= sorted[0]) return 'low'
  const rank = sorted.indexOf(price) / (sorted.length - 1)
  return rank < 1 / 3 ? 'low' : rank < 2 / 3 ? 'mid' : 'high'
}
