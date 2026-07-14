import { describe, expect, it } from 'vitest'

import {
  hasB3SecretsInEnv,
  loadB3AccessSecretsFromEnv,
  resolveB3AccessSecrets,
} from '../src/modules/b3/infrastructure/load-b3-secrets.js'

const samplePem = `-----BEGIN CERTIFICATE-----
MIIBsample
-----END CERTIFICATE-----
`

const sampleKey = `-----BEGIN PRIVATE KEY-----
MIIBsamplekey
-----END PRIVATE KEY-----
`

describe('B3 secrets from env (Vercel)', () => {
  it('loads PEM from base64 env vars', () => {
    const secrets = loadB3AccessSecretsFromEnv({
      B3_CLIENT_ID: 'client-from-env',
      B3_CLIENT_SECRET: 'secret-from-env',
      B3_MTLS_CERT_PEM_BASE64: Buffer.from(samplePem, 'utf8').toString('base64'),
      B3_MTLS_KEY_PEM_BASE64: Buffer.from(sampleKey, 'utf8').toString('base64'),
    })

    expect(secrets.clientId).toBe('client-from-env')
    expect(secrets.clientSecret).toBe('secret-from-env')
    expect(secrets.certificatePem).toContain('BEGIN CERTIFICATE')
    expect(secrets.privateKeyPem).toContain('BEGIN PRIVATE KEY')
  })

  it('loads PEM from escaped single-line env vars', () => {
    const secrets = loadB3AccessSecretsFromEnv({
      B3_CLIENT_ID: 'client-from-env',
      B3_CLIENT_SECRET: 'secret-from-env',
      B3_MTLS_CERT_PEM: samplePem.replace(/\n/g, '\\n'),
      B3_MTLS_KEY_PEM: sampleKey.replace(/\n/g, '\\n'),
    })

    expect(secrets.certificatePem).toContain('\n')
    expect(secrets.privateKeyPem).toContain('BEGIN PRIVATE KEY')
  })

  it('prefers env secrets over directory when both could exist', () => {
    const secrets = resolveB3AccessSecrets({
      secretsDir: '.secrets/b3/production',
      env: {
        B3_CLIENT_ID: 'env-client',
        B3_CLIENT_SECRET: 'env-secret',
        B3_MTLS_CERT_PEM_BASE64: Buffer.from(samplePem, 'utf8').toString('base64'),
        B3_MTLS_KEY_PEM_BASE64: Buffer.from(sampleKey, 'utf8').toString('base64'),
      },
    })

    expect(secrets?.clientId).toBe('env-client')
  })

  it('returns null when neither env nor directory is configured', () => {
    expect(resolveB3AccessSecrets({ secretsDir: null, env: {} })).toBeNull()
    expect(hasB3SecretsInEnv({})).toBe(false)
  })

  it('rejects invalid base64 that is not PEM', () => {
    expect(() =>
      loadB3AccessSecretsFromEnv({
        B3_CLIENT_ID: 'client',
        B3_CLIENT_SECRET: 'secret',
        B3_MTLS_CERT_PEM_BASE64: Buffer.from('not-a-pem', 'utf8').toString('base64'),
        B3_MTLS_KEY_PEM_BASE64: Buffer.from(sampleKey, 'utf8').toString('base64'),
      }),
    ).toThrow(/certificate/)
  })
})
