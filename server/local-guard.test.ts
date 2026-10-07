import { describe, expect, it } from 'vitest'
import { isAllowedOrigin, isLocalHost } from './local-guard.js'

describe('local-guard', () => {
  it('accepts loopback Host headers with or without port', () => {
    expect(isLocalHost('127.0.0.1:8787')).toBe(true)
    expect(isLocalHost('localhost:5173')).toBe(true)
    expect(isLocalHost('localhost')).toBe(true)
  })

  it('rejects other Host headers (DNS rebinding)', () => {
    expect(isLocalHost('evil.example:8787')).toBe(false)
    expect(isLocalHost('127.0.0.1.evil.example')).toBe(false)
    expect(isLocalHost(undefined)).toBe(false)
  })

  it('accepts missing Origin (curl, same-origin GET) and loopback origins', () => {
    expect(isAllowedOrigin(undefined)).toBe(true)
    expect(isAllowedOrigin('http://127.0.0.1:5173')).toBe(true)
    expect(isAllowedOrigin('http://localhost:5173')).toBe(true)
  })

  it('rejects foreign or malformed origins (CSRF)', () => {
    expect(isAllowedOrigin('https://evil.example')).toBe(false)
    expect(isAllowedOrigin('http://localhost.evil.example')).toBe(false)
    expect(isAllowedOrigin('null')).toBe(false)
  })
})
