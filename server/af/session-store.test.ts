import { describe, expect, it } from 'vitest'
import { cookiesToRestore, cookiesToSave } from './session-store.js'

const cookie = (name: string, domain: string, expires: number) => ({
  name, value: 'v', domain, path: '/', expires, httpOnly: true, secure: true, sameSite: 'Lax' as const,
})

describe('session-store', () => {
  it('saves only Air France / Air France-KLM cookies', () => {
    const saved = cookiesToSave([
      cookie('aviato_sso_sessionid', 'wwws.airfrance.nl', -1),
      cookie('ASFC.CLIENT.COOKIE', '.airfranceklm.com', 2_000_000_000),
      cookie('_ga', '.google.com', 2_000_000_000),
    ])
    expect(saved.map((item) => item.name)).toEqual(['aviato_sso_sessionid', 'ASFC.CLIENT.COOKIE'])
  })

  it('restores only session cookies into a persistent profile (the profile keeps the rest)', () => {
    const restored = cookiesToRestore([
      cookie('aviato_sso_sessionid', 'wwws.airfrance.nl', -1),
      cookie('_abck', '.airfrance.nl', 2_000_000_000),
    ], { persistentProfile: true, nowSeconds: 1_800_000_000 })
    expect(restored.map((item) => item.name)).toEqual(['aviato_sso_sessionid'])
  })

  it('restores session and unexpired cookies into an empty browser, never expired ones', () => {
    const restored = cookiesToRestore([
      cookie('aviato_sso_sessionid', 'wwws.airfrance.nl', -1),
      cookie('fresh', '.airfrance.nl', 1_900_000_000),
      cookie('stale', '.airfrance.nl', 1_700_000_000),
    ], { persistentProfile: false, nowSeconds: 1_800_000_000 })
    expect(restored.map((item) => item.name)).toEqual(['aviato_sso_sessionid', 'fresh'])
  })
})
