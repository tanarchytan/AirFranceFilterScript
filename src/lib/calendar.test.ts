import { describe, expect, it } from 'vitest'
import { monthGrid, monthsBetween, priceTier } from './calendar'

describe('monthGrid', () => {
  it('lays a month out Monday-first with blanks before the 1st and after the last day', () => {
    const weeks = monthGrid('2026-11')
    expect(weeks[0]).toEqual([null, null, null, null, null, null, '2026-11-01'])
    expect(weeks.at(-1)).toEqual(['2026-11-30', null, null, null, null, null, null])
    expect(weeks.flat().filter(Boolean)).toHaveLength(30)
  })
})

describe('monthsBetween', () => {
  it('lists every month the range touches', () => {
    expect(monthsBetween('2026-10-09', '2027-01-14')).toEqual(['2026-10', '2026-11', '2026-12', '2027-01'])
  })
})

describe('priceTier', () => {
  it('marks the cheapest third low, the dearest third high', () => {
    const prices = [100, 200, 300, 400, 500, 600]
    expect(priceTier(100, prices)).toBe('low')
    expect(priceTier(300, prices)).toBe('mid')
    expect(priceTier(600, prices)).toBe('high')
  })
  it('treats a single price as low', () => {
    expect(priceTier(60000, [60000, 60000])).toBe('low')
  })
})
