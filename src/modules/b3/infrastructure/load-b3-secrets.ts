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

export function resolveB3SecretsDir(secretsDir: string, cwd = process.cwd()): string {
  return isAbsolute(secretsDir) ? secretsDir : resolve(cwd, secretsDir)
}

export function loadB3AccessSecrets(secretsDir: string): B3AccessSecrets {
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
