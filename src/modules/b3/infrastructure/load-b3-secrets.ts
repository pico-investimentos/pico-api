import { readFileSync, readdirSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

export type B3AccessSecrets = Readonly<{
  clientId: string
  clientSecret: string
  certificatePem: string
  privateKeyPem: string
  p12Password: string
}>

function readRequiredFile(directory: string, fileName: string): string {
  return readFileSync(join(directory, fileName), 'utf8')
}

function findBySuffix(directory: string, suffix: string): string {
  const match = readdirSync(directory).find((name) => name.endsWith(suffix))
  if (!match) {
    throw new Error(`B3 secrets: missing file ending with ${suffix} in ${directory}`)
  }
  return match
}

function parseClientIdSecret(raw: string): { clientId: string; clientSecret: string } {
  const clientId = raw.match(/^Client_ID:\s*(.+)$/im)?.[1]?.trim()
  const clientSecret = raw.match(/^Secret:\s*(.+)$/im)?.[1]?.trim()

  if (!clientId || !clientSecret) {
    throw new Error('B3 secrets: invalid *_client_id_secret.txt format')
  }

  return { clientId, clientSecret }
}

function decodePem(input: {
  base64?: string
  pem?: string
  label: string
}): string {
  const base64 = input.base64?.trim()
  if (base64) {
    const decoded = Buffer.from(base64, 'base64').toString('utf8').trim()
    if (!decoded.includes('BEGIN')) {
      throw new Error(`B3 secrets: ${input.label} base64 did not decode to PEM`)
    }
    return decoded.includes('\\n') ? decoded.replace(/\\n/g, '\n') : decoded
  }

  const pem = input.pem?.trim()
  if (pem) {
    const normalized = pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem
    if (!normalized.includes('BEGIN')) {
      throw new Error(`B3 secrets: ${input.label} PEM is invalid`)
    }
    return normalized
  }

  throw new Error(`B3 secrets: missing ${input.label}`)
}

export function resolveB3SecretsDir(secretsDir: string, cwd = process.cwd()): string {
  return isAbsolute(secretsDir) ? secretsDir : resolve(cwd, secretsDir)
}

export function loadB3AccessSecretsFromDirectory(secretsDir: string): B3AccessSecrets {
  const directory = resolveB3SecretsDir(secretsDir)
  const clientFile = findBySuffix(directory, '_client_id_secret.txt')
  const passwordFile = findBySuffix(directory, '_senha_p12.txt')
  const certificateFile = findBySuffix(directory, '.cer')
  const keyFile = findBySuffix(directory, '.key')
  const { clientId, clientSecret } = parseClientIdSecret(readRequiredFile(directory, clientFile))

  return Object.freeze({
    clientId,
    clientSecret,
    certificatePem: readRequiredFile(directory, certificateFile),
    privateKeyPem: readRequiredFile(directory, keyFile),
    p12Password: readRequiredFile(directory, passwordFile).trim(),
  })
}

/** @deprecated Prefer resolveB3AccessSecrets — kept for call sites that only use disk. */
export function loadB3AccessSecrets(secretsDir: string): B3AccessSecrets {
  return loadB3AccessSecretsFromDirectory(secretsDir)
}

export function hasB3SecretsInEnv(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const hasClient = Boolean(env.B3_CLIENT_ID?.trim() && env.B3_CLIENT_SECRET?.trim())
  const hasCert = Boolean(env.B3_MTLS_CERT_PEM_BASE64?.trim() || env.B3_MTLS_CERT_PEM?.trim())
  const hasKey = Boolean(env.B3_MTLS_KEY_PEM_BASE64?.trim() || env.B3_MTLS_KEY_PEM?.trim())
  return hasClient && hasCert && hasKey
}

export function loadB3AccessSecretsFromEnv(
  env: Record<string, string | undefined> = process.env,
): B3AccessSecrets {
  const clientId = env.B3_CLIENT_ID?.trim()
  const clientSecret = env.B3_CLIENT_SECRET?.trim()

  if (!clientId || !clientSecret) {
    throw new Error('B3 secrets: B3_CLIENT_ID and B3_CLIENT_SECRET are required')
  }

  return Object.freeze({
    clientId,
    clientSecret,
    certificatePem: decodePem({
      ...(env.B3_MTLS_CERT_PEM_BASE64 ? { base64: env.B3_MTLS_CERT_PEM_BASE64 } : {}),
      ...(env.B3_MTLS_CERT_PEM ? { pem: env.B3_MTLS_CERT_PEM } : {}),
      label: 'certificate',
    }),
    privateKeyPem: decodePem({
      ...(env.B3_MTLS_KEY_PEM_BASE64 ? { base64: env.B3_MTLS_KEY_PEM_BASE64 } : {}),
      ...(env.B3_MTLS_KEY_PEM ? { pem: env.B3_MTLS_KEY_PEM } : {}),
      label: 'private key',
    }),
    p12Password: env.B3_P12_PASSWORD?.trim() ?? '',
  })
}

/**
 * Resolve B3 mTLS/OAuth secrets for local disk or Vercel env.
 * Preferência: variáveis de ambiente completas → depois B3_SECRETS_DIR.
 */
export function resolveB3AccessSecrets(input: {
  secretsDir?: string | null
  env?: Record<string, string | undefined>
}): B3AccessSecrets | null {
  const env = input.env ?? process.env

  if (hasB3SecretsInEnv(env)) {
    return loadB3AccessSecretsFromEnv(env)
  }

  if (input.secretsDir?.trim()) {
    return loadB3AccessSecretsFromDirectory(input.secretsDir.trim())
  }

  return null
}
