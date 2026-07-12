export type AuthenticatedUser = Readonly<{
  id: string
  email: string
  cpf: string | null
  isActive: boolean
}>

export type UserRecord = AuthenticatedUser &
  Readonly<{
    passwordHash: string
  }>

export type SessionRecord = Readonly<{
  id: string
  userId: string
  tokenHash: string
  expiresAt: Date
}>

export type B3ConnectionStatus =
  | 'NOT_CONNECTED'
  | 'AUTHORIZATION_REQUESTED'
  | 'AUTHORIZED'
  | 'REVOKED'
  | 'ERROR'

export type B3ConnectionRecord = Readonly<{
  id: string
  userId: string
  status: B3ConnectionStatus
  latestAttemptId: string | null
  authorizationRequestedAt: Date | null
}>

export type B3AuthorizationAttemptRecord = Readonly<{
  id: string
  userId: string
  idempotencyKeyHash: string
  environment: 'certification' | 'production'
  status: B3ConnectionStatus
  requestId: string
  createdAt: Date
}>

export type AuditEventInput = Readonly<{
  action: string
  actorType: string
  actorId: string | null
  targetType: string
  targetId: string | null
  requestId: string
  metadata?: Record<string, unknown>
}>
