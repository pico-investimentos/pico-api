import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)

const SCRYPT_KEYLEN = 64

export function hashSha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function createSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const derived = (await scrypt(password, salt, SCRYPT_KEYLEN)) as Buffer
  return `${salt}:${derived.toString('hex')}`
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
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
