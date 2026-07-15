export const B3_POSITION_PRODUCTS = [
  'equities',
  'fixed-income',
  'treasury-bonds',
  'derivatives',
  'securities-lending',
] as const

export type B3PositionProduct = (typeof B3_POSITION_PRODUCTS)[number]

export type B3SyncRunStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'
export type B3SyncTrigger = 'MANUAL' | 'CRON'

export type B3PositionDispatchRecord = Readonly<{
  id: string
  environment: 'certification' | 'production'
  referenceDate: string
  businessDay: string
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'SUPERSEDED'
  cursorUserId: string | null
  leaseToken: string | null
  leaseExpiresAt: Date | null
  requestId: string
  finishedAt: Date | null
  createdAt: Date
}>

export type B3SyncRunRecord = Readonly<{
  id: string
  userId: string
  documentHash: string
  environment: 'certification' | 'production'
  kind: 'POSITION_D1'
  status: B3SyncRunStatus
  trigger: B3SyncTrigger
  requestId: string
  businessDay: string
  referenceDate: string
  startedAt: Date | null
  finishedAt: Date | null
  errorCode: string | null
  errorMessage: string | null
  createdAt: Date
}>

export type PortfolioPositionRecord = Readonly<{
  id: string
  userId: string
  environment: 'certification' | 'production'
  syncRunId: string
  referenceDate: string
  product: B3PositionProduct
  naturalKeyHash: string
  instrumentCode: string | null
  quantity: string | null
  rawPayload: Record<string, unknown>
  isCurrent: boolean
  supersededAt: Date | null
  sourceSyncedAt: Date
}>

export type PortfolioPositionInput = Readonly<{
  product: B3PositionProduct
  naturalKeyHash: string
  instrumentCode: string | null
  quantity: string | null
  rawPayload: Record<string, unknown>
}>
