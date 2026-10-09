import { describe, expect, it } from 'vitest'
import { FLYING_BLUE_LOGIN_URL } from './auth-login.js'
import { MARKET, ORIGIN } from './market.js'

describe('Flying Blue login helpers', () => {
  it('starts the site OAuth login for the market (as captured on airfrance.nl)', () => {
    expect(FLYING_BLUE_LOGIN_URL).toBe(`${ORIGIN}/endpoint/v1/oauth/redirect?loginPrompt=&source=search&locale=${MARKET.loginLocale}`)
    expect(FLYING_BLUE_LOGIN_URL).not.toContain('/identification')
  })
})
