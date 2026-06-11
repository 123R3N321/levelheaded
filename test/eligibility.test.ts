import { describe, expect, it } from 'vitest'

import { isSafeToTap } from '../src/content/eligibility'

const NETFLIX = 'https://www.netflix.com'

describe('isSafeToTap', () => {
  it('accepts blob: URLs (MSE — all major streamers)', () => {
    expect(isSafeToTap('blob:https://www.netflix.com/abc-123', NETFLIX)).toBe(true)
  })

  it('accepts data: URLs', () => {
    expect(isSafeToTap('data:video/mp4;base64,AAAA', NETFLIX)).toBe(true)
  })

  it('accepts same-origin absolute URLs', () => {
    expect(isSafeToTap('https://www.netflix.com/video.mp4', NETFLIX)).toBe(true)
  })

  it('accepts relative URLs (resolved against the page origin)', () => {
    expect(isSafeToTap('/assets/video.mp4', NETFLIX)).toBe(true)
  })

  it('rejects cross-origin URLs — CORS silence risk', () => {
    expect(isSafeToTap('https://cdn.example.com/video.mp4', NETFLIX)).toBe(false)
  })

  it('rejects a different subdomain (distinct origin)', () => {
    expect(isSafeToTap('https://cdn.netflix.com/video.mp4', NETFLIX)).toBe(false)
  })

  it('rejects a different scheme (distinct origin)', () => {
    expect(isSafeToTap('http://www.netflix.com/video.mp4', NETFLIX)).toBe(false)
  })

  it('rejects empty and unparseable sources', () => {
    expect(isSafeToTap('', NETFLIX)).toBe(false)
    expect(isSafeToTap('https://', NETFLIX)).toBe(false)
  })
})
