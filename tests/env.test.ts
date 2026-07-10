import { describe, expect, it } from 'vitest'

import { loadConfig } from '../src/config/env.js'

describe('environment configuration', () => {
  it('normalizes and deduplicates allowed origins', () => {
    const config = loadConfig({
      APP_ORIGINS: 'http://localhost:5173/, http://localhost:5173',
    })

    expect(config.appOrigins).toEqual(['http://localhost:5173'])
  })

  it('rejects invalid origins', () => {
    expect(() => loadConfig({ APP_ORIGINS: 'not-a-url' })).toThrow()
  })
})
