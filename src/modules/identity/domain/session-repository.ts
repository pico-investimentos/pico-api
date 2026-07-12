import type { SessionRecord } from '../../../shared/domain/types.js'

export interface SessionRepository {
  create(input: {
    userId: string
    tokenHash: string
    expiresAt: Date
  }): Promise<SessionRecord>
  findByTokenHash(tokenHash: string): Promise<SessionRecord | null>
  deleteByTokenHash(tokenHash: string): Promise<void>
  deleteExpired(now: Date): Promise<void>
}
