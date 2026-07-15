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

  it('prefers canonical DATABASE_* names over marketplace aliases', () => {
    const config = loadConfig({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://canonical:pass@pooler:6543/db',
      DATABASE_MIGRATION_URL: 'postgresql://canonical:pass@db:5432/db',
      SUPABASE_POSTGRES_URL: 'postgresql://supabase:pass@pooler:6543/db',
      SUPABASE_POSTGRES_URL_NON_POOLING: 'postgresql://supabase:pass@db:5432/db',
      B3_ENVIRONMENT: 'certification',
      B3_OPT_IN_URL: 'https://optin.b3.example/authorize',
      B3_OPT_IN_ALLOWED_HOSTS: 'optin.b3.example',
    })

    expect(config.databaseUrl).toBe('postgresql://canonical:pass@pooler:6543/db')
    expect(config.databaseMigrationUrl).toBe('postgresql://canonical:pass@db:5432/db')
  })

  it('rejects migration config when only pooled url is available', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'development',
        SUPABASE_POSTGRES_URL: 'postgresql://user:pass@pooler:6543/db',
        B3_ENVIRONMENT: 'certification',
        B3_OPT_IN_URL: 'https://optin.b3.example/authorize',
        B3_OPT_IN_ALLOWED_HOSTS: 'optin.b3.example',
      }),
    ).toThrow(/DATABASE_MIGRATION_URL/)
  })

  it('rejects B3 opt-in urls outside the allowlist', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        DATABASE_MIGRATION_URL: 'postgresql://user:pass@localhost:5432/db',
        B3_ENVIRONMENT: 'certification',
        B3_OPT_IN_URL: 'https://evil.example/authorize',
        B3_OPT_IN_ALLOWED_HOSTS: 'optin.b3.example',
      }),
    ).toThrow(/hostname is not allowed/)
  })

  it('derives API base url from B3 environment', () => {
    const certification = loadConfig({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      DATABASE_MIGRATION_URL: 'postgresql://user:pass@localhost:5432/db',
      B3_ENVIRONMENT: 'certification',
      B3_OPT_IN_URL: 'https://b3investidorcer.b2clogin.com/authorize',
      B3_OPT_IN_ALLOWED_HOSTS: 'b3investidorcer.b2clogin.com',
      B3_SECRETS_DIR: '.secrets/b3/certification',
    })

    const production = loadConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      DATABASE_MIGRATION_URL: 'postgresql://user:pass@localhost:5432/db',
      RATE_LIMIT_KEY_SECRET: 'test-rate-limit-key-secret-123456789',
      B3_ENVIRONMENT: 'production',
      B3_OPT_IN_URL: 'https://b3investidor.b2clogin.com/authorize',
      B3_OPT_IN_ALLOWED_HOSTS: 'b3investidor.b2clogin.com',
      B3_SECRETS_DIR: '.secrets/b3/production',
    })

    expect(certification.b3.apiBaseUrl).toBe('https://apib3i-cert.b3.com.br:2443')
    expect(certification.b3.secretsDir).toBe('.secrets/b3/certification')
    expect(certification.b3.oauthScope).toContain('98ddf4b0')
    expect(production.b3.apiBaseUrl).toBe('https://investidor.b3.com.br:2443')
    expect(production.b3.secretsDir).toBe('.secrets/b3/production')
    expect(production.b3.oauthScope).toContain('abae5dfa')
  })

  it('requires a rate-limit HMAC secret in production', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        DATABASE_MIGRATION_URL: 'postgresql://user:pass@localhost:5432/db',
      }),
    ).toThrow(/RATE_LIMIT_KEY_SECRET/)
  })

  it('rejects a placeholder rate-limit secret in production', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        DATABASE_MIGRATION_URL: 'postgresql://user:pass@localhost:5432/db',
        RATE_LIMIT_KEY_SECRET: 'change-me-with-at-least-32-random-characters',
      }),
    ).toThrow(/placeholder/)
  })

  it('defaults B3 HTTP timeout and in-memory allow flag', () => {
    const config = loadConfig({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      DATABASE_MIGRATION_URL: 'postgresql://user:pass@localhost:5432/db',
      B3_ENVIRONMENT: 'certification',
      B3_OPT_IN_URL: 'https://optin.b3.example/authorize',
      B3_OPT_IN_ALLOWED_HOSTS: 'optin.b3.example',
    })

    expect(config.b3.httpTimeoutMs).toBe(30_000)
    expect(config.b3.allowInMemory).toBe(false)
  })
})
