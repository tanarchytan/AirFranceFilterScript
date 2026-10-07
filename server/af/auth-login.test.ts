import { describe, expect, it } from 'vitest'
import { FLYING_BLUE_LOGIN_URL } from './auth-login.js'
import { ORIGIN } from './market.js'

describe('Flying Blue login helpers', () => {
  it('points the login window at the market identification gateway', () => {
    expect(FLYING_BLUE_LOGIN_URL).toBe(`${ORIGIN}/identification`)
    expect(FLYING_BLUE_LOGIN_URL).toMatch(/^https:\/\/wwws\.airfrance\.(fr|nl)\/identification$/)
  })
})
