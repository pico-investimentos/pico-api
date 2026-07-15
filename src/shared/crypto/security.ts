import {
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto'
import { promisify } from 'node:util'
import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2'

const scrypt = promisify(scryptCallback)

const SCRYPT_KEYLEN = 64
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const

export function hashSha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function hashHmacSha256(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex')
}

export function createSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

export async function hashPassword(password: string): Promise<string> {
  return argon2Hash(password, ARGON2_OPTIONS)
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  if (passwordHash.startsWith('$argon2')) {
    return argon2Verify(passwordHash, password)
  }

  return verifyLegacyScryptPassword(password, passwordHash)
}

export function needsPasswordRehash(passwordHash: string): boolean {
  return !passwordHash.startsWith('$argon2id$')
}

/**
 * Migration-only verifier for hashes created before Argon2 adoption.
 * Successful logins replace this format through `needsPasswordRehash`.
 */
async function verifyLegacyScryptPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  const [salt, hash] = passwordHash.split(':')

  if (!salt || !hash) {
    return false
  }

  const derived = (await scrypt(password, salt, SCRYPT_KEYLEN)) as Buffer
  const expected = Buffer.from(hash, 'hex')

  if (expected.length !== derived.length) {
    return false
  }

  return timingSafeEqual(expected, derived)
}

export function isValidCpf(rawCpf: string): boolean {
  const cpf = rawCpf.replace(/\D/g, '')

  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) {
    return false
  }

  const digits = cpf.split('').map(Number)

  const calcDigit = (length: number) => {
    let sum = 0
    for (let index = 0; index < length; index += 1) {
      sum += (digits[index] ?? 0) * (length + 1 - index)
    }
    const remainder = (sum * 10) % 11
    return remainder === 10 ? 0 : remainder
  }

  return calcDigit(9) === digits[9] && calcDigit(10) === digits[10]
}

export function normalizeCpf(rawCpf: string): string {
  return rawCpf.replace(/\D/g, '')
}
