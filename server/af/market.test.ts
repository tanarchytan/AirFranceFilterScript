import { describe, expect, it } from 'vitest'
import { parseClientRevision, resolveMarket } from './market.js'

describe('market', () => {
  it('defaults to nl and accepts fr in any case', () => {
    expect(resolveMarket(undefined).host).toBe('wwws.airfrance.nl')
    expect(resolveMarket('FR').country).toBe('FR')
  })

  it('rejects unknown markets with the valid list', () => {
    expect(() => resolveMarket('de')).toThrow(/fr, nl/)
  })

  it('reads the client revision from page config', () => {
    const html = '{"componentsVersion":"46.0.0","revision":"52aa181c0c2bbbf8429fc005d8ff15b4555cfd97","x":1}'
    expect(parseClientRevision(html)).toBe('52aa181c0c2bbbf8429fc005d8ff15b4555cfd97')
    expect(parseClientRevision('<html></html>')).toBeUndefined()
  })
})
