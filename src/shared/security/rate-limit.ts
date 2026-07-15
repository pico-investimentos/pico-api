import { hashHmacSha256 } from '../crypto/security.js'
import { AppError } from '../http/app-error.js'
import type { RateLimitRepository } from './rate-limit-repository.js'

export function createRateLimitKey(
  secret: string,
  scope: string,
  identifier: string,
): string {
  return hashHmacSha256(secret, `${scope}:${identifier}`)
}

export async function enforceRateLimit(
  repository: RateLimitRepository,
  input: {
    keyHash: string
    limit: number
    windowMs: number
    blockMs: number
    now: Date
  },
): Promise<void> {
  const result = await repository.consume(input)
  if (!result.allowed) {
    throw new AppError(
      429,
      'RATE_LIMITED',
      'Muitas tentativas. Aguarde antes de tentar novamente.',
      { 'Retry-After': String(result.retryAfterSeconds) },
    )
  }
}
