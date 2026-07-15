export type RateLimitResult = Readonly<{
  allowed: boolean
  retryAfterSeconds: number
}>

export interface RateLimitRepository {
  consume(input: {
    keyHash: string
    limit: number
    windowMs: number
    blockMs: number
    now: Date
  }): Promise<RateLimitResult>
  reset(keyHash: string): Promise<void>
}
