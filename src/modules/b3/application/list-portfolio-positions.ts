import type { B3Config } from '../../../config/env.js'
import type { PositionSyncStore } from '../domain/position-sync-repositories.js'
import type { B3PositionProduct } from '../domain/position-types.js'

export type ListPortfolioPositionsOutput = Readonly<{
  positions: readonly {
    id: string
    product: B3PositionProduct
    referenceDate: string
    instrumentCode: string | null
    quantity: string | null
    syncRunId: string
    sourceSyncedAt: string
  }[]
  nextCursor: string | null
}>

export class ListPortfolioPositions {
  constructor(
    private readonly store: PositionSyncStore,
    private readonly config: B3Config,
  ) {}

  async execute(input: {
    userId: string
    cursor?: string
    limit?: number
  }): Promise<ListPortfolioPositionsOutput> {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100)
    const rows = await this.store.positions.listByUser({
      userId: input.userId,
      environment: this.config.environment,
      ...(input.cursor ? { cursor: input.cursor } : {}),
      limit: limit + 1,
    })
    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows

    return {
      positions: Object.freeze(
        page.map((row) => ({
          id: row.id,
          product: row.product,
          referenceDate: row.referenceDate,
          instrumentCode: row.instrumentCode,
          quantity: row.quantity,
          syncRunId: row.syncRunId,
          sourceSyncedAt: row.sourceSyncedAt.toISOString(),
        })),
      ),
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    }
  }
}
