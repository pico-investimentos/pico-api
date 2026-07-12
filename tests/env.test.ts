import { describe, expect, it } from 'vitest'

import { loadConfig } from '../src/config/env.js'

describe('environment configuration', () => {
  it('normalizes and deduplicates allowed origins', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      APP_ORIGINS: 'http://localhost:5173/, http://localhost:5173',
    })

    expect(config.appOrigins).toEqual(['http://localhost:5173'])
  })

  it('rejects invalid origins', () => {
    expect(() => loadConfig({ NODE_ENV: 'test', APP_ORIGINS: 'not-a-url' })).toThrow()
  })

  it('maps marketplace postgres urls to internal names', () => {
    const config = loadConfig({
      NODE_ENV: 'development',
      POSTGRES_URL: 'postgresql://user:pass@pooler:6543/db',
      POSTGRES_URL_NON_POOLING: 'postgresql://user:pass@db:5432/db',
      B3_ENVIRONMENT: 'certification',
      B3_OPT_IN_URL: 'https://optin.b3.example/authorize',
      B3_OPT_IN_ALLOWED_HOSTS: 'optin.b3.example',
    })

    expect(config.databaseUrl).toBe('postgresql://user:pass@pooler:6543/db')
    expect(config.databaseMigrationUrl).toBe('postgresql://user:pass@db:5432/db')
    expect(config.b3.optInUrl).toBe('https://optin.b3.example/authorize')
  })

  it('rejects B3 opt-in urls outside the allowlist', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        B3_ENVIRONMENT: 'certification',
        B3_OPT_IN_URL: 'https://evil.example/authorize',
        B3_OPT_IN_ALLOWED_HOSTS: 'optin.b3.example',
      }),
    ).toThrow(/hostname is not allowed/)
  })
})
