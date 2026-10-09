import { describe, expect, it } from 'vitest'
import { isBlockError, SourceCooldown, SourceCoolingDownError } from './source-cooldown.js'

describe('SourceCooldown', () => {
  const minutes = (value: number) => value * 60_000

  it('pauses a blocked source 10 min, doubling per repeat block up to 60 min', () => {
    let now = 0
    const cooldown = new SourceCooldown({ now: () => now })
    cooldown.recordBlock('airfrance')
    expect(cooldown.remainingMs('airfrance')).toBe(minutes(10))
    now = minutes(10)
    cooldown.recordBlock('airfrance')
    expect(cooldown.remainingMs('airfrance')).toBe(minutes(20))
    now += minutes(20)
    cooldown.recordBlock('airfrance')
    now += minutes(40)
    cooldown.recordBlock('airfrance')
    expect(cooldown.remainingMs('airfrance')).toBe(minutes(60))
  })

  it('a success resets the backoff; other sources are unaffected', () => {
    let now = 0
    const cooldown = new SourceCooldown({ now: () => now })
    cooldown.recordBlock('finnair')
    expect(cooldown.remainingMs('airfrance')).toBe(0)
    now = minutes(11)
    cooldown.recordSuccess('finnair')
    cooldown.recordBlock('finnair')
    expect(cooldown.remainingMs('finnair')).toBe(minutes(10))
  })

  it('assertAvailable throws a readable error while cooling down', () => {
    const cooldown = new SourceCooldown({ now: () => 0 })
    cooldown.recordBlock('airfrance')
    expect(() => cooldown.assertAvailable('airfrance', 'Air France')).toThrow(SourceCoolingDownError)
    expect(() => cooldown.assertAvailable('airfrance', 'Air France')).toThrow(/Air France.*10 min/)
  })
})

describe('isBlockError', () => {
  it('recognises bot-protection answers, not ordinary failures', () => {
    expect(isBlockError(new Error('HTML challenge (HTTP 403)'))).toBe(true)
    expect(isBlockError(new Error('Air France GraphQL X: HTTP 429'))).toBe(true)
    expect(isBlockError(new Error('CustomerAPI: User is not authenticated'))).toBe(false)
    expect(isBlockError(new Error('HTTP 500'))).toBe(false)
  })
})
