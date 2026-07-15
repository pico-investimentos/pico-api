import { eq, sql } from 'drizzle-orm'

import type {
  RateLimitRepository,
  RateLimitResult,
} from '../security/rate-limit-repository.js'
import type { DbExecutor } from './client.js'
import { rateLimitBuckets } from './schema/index.js'

export class DrizzleRateLimitRepository implements RateLimitRepository {
  constructor(private readonly db: DbExecutor) {}

  async consume(input: {
    keyHash: string
    limit: number
    windowMs: number
    blockMs: number
    now: Date
  }): Promise<RateLimitResult> {
    const windowFloor = new Date(input.now.getTime() - input.windowMs)
    const [bucket] = await this.db
      .insert(rateLimitBuckets)
      .values({
        keyHash: input.keyHash,
        attemptCount: 1,
        windowStartedAt: input.now,
        blockedUntil: null,
        updatedAt: input.now,
      })
      .onConflictDoUpdate({
        target: rateLimitBuckets.keyHash,
        set: {
          attemptCount: sql<number>`
            CASE
              WHEN ${rateLimitBuckets.blockedUntil} > ${input.now}
                THEN ${rateLimitBuckets.attemptCount}
              WHEN ${rateLimitBuckets.windowStartedAt} <= ${windowFloor}
                THEN 1
              ELSE ${rateLimitBuckets.attemptCount} + 1
            END
          `,
          windowStartedAt: sql<Date>`
            CASE
              WHEN ${rateLimitBuckets.blockedUntil} > ${input.now}
                THEN ${rateLimitBuckets.windowStartedAt}
              WHEN ${rateLimitBuckets.windowStartedAt} <= ${windowFloor}
                THEN ${input.now}
              ELSE ${rateLimitBuckets.windowStartedAt}
            END
          `,
          blockedUntil: sql<Date | null>`
            CASE
              WHEN ${rateLimitBuckets.blockedUntil} > ${input.now}
                THEN ${rateLimitBuckets.blockedUntil}
              WHEN ${rateLimitBuckets.windowStartedAt} <= ${windowFloor}
                THEN NULL
              WHEN ${rateLimitBuckets.attemptCount} + 1 > ${input.limit}
                THEN ${input.now} + (${input.blockMs} * interval '1 millisecond')
              ELSE NULL
            END
          `,
          updatedAt: input.now,
        },
      })
      .returning()

    if (!bucket) {
      throw new Error('Failed to consume rate-limit bucket')
    }

    const isBlocked =
      bucket.blockedUntil !== null && bucket.blockedUntil > input.now
    return {
      allowed: !isBlocked && bucket.attemptCount <= input.limit,
      retryAfterSeconds: isBlocked
        ? Math.max(
            1,
            Math.ceil(
              (bucket.blockedUntil!.getTime() - input.now.getTime()) / 1000,
            ),
          )
        : 0,
    }
  }

  async reset(keyHash: string): Promise<void> {
    await this.db
      .delete(rateLimitBuckets)
      .where(eq(rateLimitBuckets.keyHash, keyHash))
  }
}

type MemoryBucket = {
  attemptCount: number
  windowStartedAt: Date
  blockedUntil: Date | null
}

export class InMemoryRateLimitRepository implements RateLimitRepository {
  readonly buckets = new Map<string, MemoryBucket>()

  async consume(input: {
    keyHash: string
    limit: number
    windowMs: number
    blockMs: number
    now: Date
  }): Promise<RateLimitResult> {
    const existing = this.buckets.get(input.keyHash)
    if (existing?.blockedUntil && existing.blockedUntil > input.now) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil(
            (existing.blockedUntil.getTime() - input.now.getTime()) / 1000,
          ),
        ),
      }
    }

    const isExpired =
      !existing ||
      existing.windowStartedAt.getTime() <=
        input.now.getTime() - input.windowMs
    const bucket: MemoryBucket = isExpired
      ? {
          attemptCount: 1,
          windowStartedAt: input.now,
          blockedUntil: null,
        }
      : {
          ...existing,
          attemptCount: existing.attemptCount + 1,
        }

    if (bucket.attemptCount > input.limit) {
      bucket.blockedUntil = new Date(input.now.getTime() + input.blockMs)
    }
    this.buckets.set(input.keyHash, bucket)

    return {
      allowed: bucket.blockedUntil === null,
      retryAfterSeconds: bucket.blockedUntil
        ? Math.ceil((bucket.blockedUntil.getTime() - input.now.getTime()) / 1000)
        : 0,
    }
  }

  async reset(keyHash: string): Promise<void> {
    this.buckets.delete(keyHash)
  }
}
