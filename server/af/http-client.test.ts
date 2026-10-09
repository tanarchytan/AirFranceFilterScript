import { describe, expect, it } from 'vitest'
import { SimpleCookieJar } from './http-client.js'

describe('SimpleCookieJar', () => {
  it('starts from saved cookies and takes Akamai renewals from Set-Cookie', () => {
    const jar = new SimpleCookieJar([{ name: '_abck', value: 'old' }, { name: 'bm_sz', value: 'x' }])
    jar.setCookie('_abck=new~0~; Domain=.airfrance.nl; Path=/; Expires=Fri, 08 Oct 2027 08:00:00 GMT; Secure')
    expect(jar.getCookieString()).toBe('_abck=new~0~; bm_sz=x')
  })

  it('drops cookies the server expires', () => {
    const jar = new SimpleCookieJar([{ name: 'bm_sv', value: 'x' }, { name: 'keep', value: 'y' }])
    jar.setCookie('bm_sv=; Max-Age=0; Path=/')
    expect(jar.getCookieString()).toBe('keep=y')
  })

  it('ignores malformed headers', () => {
    const jar = new SimpleCookieJar()
    jar.setCookie('garbage')
    expect(jar.size).toBe(0)
  })
})
