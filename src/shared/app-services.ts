import type { AppConfig } from '../config/env.js'
import { ConfirmB3Authorization } from '../modules/b3/application/confirm-b3-authorization.js'
import { GetB3Connection } from '../modules/b3/application/get-b3-connection.js'
import { GetB3SyncStatus } from '../modules/b3/application/get-b3-sync-status.js'
import { ListPortfolioPositions } from '../modules/b3/application/list-portfolio-positions.js'
import { ProcessB3InvestorPositions } from '../modules/b3/application/process-b3-investor-positions.js'
import { ProcessB3PositionDispatch } from '../modules/b3/application/process-b3-position-dispatch.js'
import { ProcessPendingB3PositionSyncs } from '../modules/b3/application/process-pending-b3-position-syncs.js'
import { RevokeB3Authorization } from '../modules/b3/application/revoke-b3-authorization.js'
import { RunDailyB3PositionSync } from '../modules/b3/application/run-daily-b3-position-sync.js'
import { StartB3Authorization } from '../modules/b3/application/start-b3-authorization.js'
import { SyncB3InvestorPositions } from '../modules/b3/application/sync-b3-investor-positions.js'
import {
  LoginUser,
  LogoutUser,
  ResolveSession,
} from '../modules/identity/application/auth-use-cases.js'
import type { SessionRepository } from '../modules/identity/domain/session-repository.js'
import type { UserRepository } from '../modules/identity/domain/user-repository.js'
import type {
  B3AuthorizationAttemptRepository,
  B3ConnectionRepository,
  UnitOfWork,
} from '../modules/b3/domain/b3-repositories.js'
import type { PositionSyncStore } from '../modules/b3/domain/position-sync-repositories.js'
import {
  HttpB3InvestorAuthorizationClient,
  InMemoryB3InvestorAuthorizationClient,
  type B3InvestorAuthorizationClient,
} from '../modules/b3/infrastructure/b3-investor-authorization-client.js'
import {
  HttpB3PositionClient,
  InMemoryB3PositionClient,
} from '../modules/b3/infrastructure/b3-position-client.js'
import type { B3PositionClient } from '../modules/b3/domain/b3-position-client.js'
import {
  HttpB3SystemClient,
  InMemoryB3SystemClient,
} from '../modules/b3/infrastructure/b3-system-client.js'
import type { B3SystemClient } from '../modules/b3/domain/b3-system-client.js'
import { createB3HttpStack } from '../modules/b3/infrastructure/create-b3-http-stack.js'
import {
  resolveB3AccessSecrets,
} from '../modules/b3/infrastructure/load-b3-secrets.js'
import { createDatabaseClient } from './database/client.js'
import {
  DrizzleB3AuthorizationAttemptRepository,
  DrizzleB3ConnectionRepository,
  DrizzleSessionRepository,
  DrizzleUnitOfWork,
  DrizzleUserRepository,
} from './database/drizzle-repositories.js'
import {
  InMemoryAuditRepository,
  InMemoryB3AuthorizationAttemptRepository,
  InMemoryB3ConnectionRepository,
  InMemorySessionRepository,
  InMemoryUnitOfWork,
  InMemoryUserRepository,
} from './database/memory-repositories.js'
import {
  DrizzlePositionSyncStore,
  InMemoryPositionSyncStore,
} from './database/position-sync-store.js'
import {
  DrizzleRateLimitRepository,
  InMemoryRateLimitRepository,
} from './database/rate-limit-repositories.js'
import type { RateLimitRepository } from './security/rate-limit-repository.js'

export type AppServices = {
  users: UserRepository
  sessions: SessionRepository
  connections: B3ConnectionRepository
  attempts: B3AuthorizationAttemptRepository
  unitOfWork: UnitOfWork
  positionSyncStore: PositionSyncStore
  rateLimits: RateLimitRepository
  b3Client: B3InvestorAuthorizationClient
  b3PositionClient: B3PositionClient
  b3SystemClient: B3SystemClient
  loginUser: LoginUser
  logoutUser: LogoutUser
  resolveSession: ResolveSession
  startB3Authorization: StartB3Authorization
  getB3Connection: GetB3Connection
  confirmB3Authorization: ConfirmB3Authorization
  revokeB3Authorization: RevokeB3Authorization
  syncB3InvestorPositions: SyncB3InvestorPositions
  getB3SyncStatus: GetB3SyncStatus
  listPortfolioPositions: ListPortfolioPositions
  runDailyB3PositionSync: RunDailyB3PositionSync
  processB3InvestorPositions: ProcessB3InvestorPositions
  processB3PositionDispatch: ProcessB3PositionDispatch
  processPendingB3PositionSyncs: ProcessPendingB3PositionSyncs
  close?: () => Promise<void>
}

const B3_SECRETS_REQUIRED_MESSAGE =
  'B3 access package required: set B3_SECRETS_DIR or B3_CLIENT_ID + B3_CLIENT_SECRET + B3_MTLS_*_PEM_BASE64 (or B3_ALLOW_INMEMORY=1 outside production)'

export function createB3Clients(
  config: AppConfig,
  options?: {
    authorizedDocuments?: ReadonlySet<string>
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>
    positionClient?: B3PositionClient
    systemClient?: B3SystemClient
  },
): {
  b3Client: B3InvestorAuthorizationClient
  b3PositionClient: B3PositionClient
  b3SystemClient: B3SystemClient
} {
  if (config.nodeEnv === 'test') {
    return {
      b3Client: new InMemoryB3InvestorAuthorizationClient(options?.authorizedDocuments),
      b3PositionClient: options?.positionClient ?? new InMemoryB3PositionClient(),
      b3SystemClient: options?.systemClient ?? new InMemoryB3SystemClient(),
    }
  }

  const secrets = resolveB3AccessSecrets({
    secretsDir: config.b3.secretsDir,
    env: options?.env ?? process.env,
  })

  if (!secrets) {
    if (config.nodeEnv === 'production') {
      throw new Error(B3_SECRETS_REQUIRED_MESSAGE)
    }

    if (config.b3.allowInMemory) {
      return {
        b3Client: new InMemoryB3InvestorAuthorizationClient(options?.authorizedDocuments),
        b3PositionClient: options?.positionClient ?? new InMemoryB3PositionClient(),
        b3SystemClient: options?.systemClient ?? new InMemoryB3SystemClient(),
      }
    }

    throw new Error(B3_SECRETS_REQUIRED_MESSAGE)
  }

  const stack = createB3HttpStack(config.b3, secrets)
  return {
    b3Client: new HttpB3InvestorAuthorizationClient(config.b3, stack),
    b3PositionClient: new HttpB3PositionClient(config.b3, stack),
    b3SystemClient: new HttpB3SystemClient(config.b3, stack),
  }
}

/** @deprecated Prefer createB3Clients — kept for existing tests. */
export function createB3InvestorAuthorizationClient(
  config: AppConfig,
  options?: {
    authorizedDocuments?: ReadonlySet<string>
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>
  },
): B3InvestorAuthorizationClient {
  return createB3Clients(config, options).b3Client
}

function buildUseCases(
  config: AppConfig,
  users: UserRepository,
  sessions: SessionRepository,
  connections: B3ConnectionRepository,
  unitOfWork: UnitOfWork,
  positionSyncStore: PositionSyncStore,
  rateLimits: RateLimitRepository,
  b3Client: B3InvestorAuthorizationClient,
  b3PositionClient: B3PositionClient,
  b3SystemClient: B3SystemClient,
): Omit<
  AppServices,
  | 'users'
  | 'sessions'
  | 'connections'
  | 'attempts'
  | 'unitOfWork'
  | 'positionSyncStore'
  | 'rateLimits'
  | 'b3Client'
  | 'b3PositionClient'
  | 'b3SystemClient'
  | 'close'
> {
  const syncB3InvestorPositions = new SyncB3InvestorPositions(
    users,
    connections,
    positionSyncStore,
    b3SystemClient,
    config.b3,
  )
  const processB3InvestorPositions = new ProcessB3InvestorPositions(
    users,
    connections,
    positionSyncStore,
    b3PositionClient,
    config.b3,
  )
  const processB3PositionDispatch = new ProcessB3PositionDispatch(
    connections,
    positionSyncStore,
    syncB3InvestorPositions,
    config.b3,
  )

  return {
    loginUser: new LoginUser(users, sessions, rateLimits, config),
    logoutUser: new LogoutUser(sessions),
    resolveSession: new ResolveSession(users, sessions),
    startB3Authorization: new StartB3Authorization(users, unitOfWork, config.b3),
    getB3Connection: new GetB3Connection(connections),
    confirmB3Authorization: new ConfirmB3Authorization(
      users,
      unitOfWork,
      b3Client,
      config.b3,
    ),
    revokeB3Authorization: new RevokeB3Authorization(
      users,
      unitOfWork,
      rateLimits,
      config.rateLimitKeySecret,
      b3Client,
      config.b3,
    ),
    syncB3InvestorPositions,
    processB3InvestorPositions,
    processB3PositionDispatch,
    processPendingB3PositionSyncs: new ProcessPendingB3PositionSyncs(
      positionSyncStore,
      processB3PositionDispatch,
      processB3InvestorPositions,
      config.b3,
    ),
    getB3SyncStatus: new GetB3SyncStatus(positionSyncStore, config.b3),
    listPortfolioPositions: new ListPortfolioPositions(positionSyncStore, config.b3),
    runDailyB3PositionSync: new RunDailyB3PositionSync(
      b3SystemClient,
      positionSyncStore,
      config.b3,
    ),
  }
}

export function createMemoryServices(
  config: AppConfig,
  options?: {
    authorizedDocuments?: ReadonlySet<string>
    positionClient?: B3PositionClient
    systemClient?: B3SystemClient
  },
): AppServices {
  const users = new InMemoryUserRepository()
  const sessions = new InMemorySessionRepository()
  const connections = new InMemoryB3ConnectionRepository()
  const attempts = new InMemoryB3AuthorizationAttemptRepository()
  const audit = new InMemoryAuditRepository()
  const unitOfWork = new InMemoryUnitOfWork({ connections, attempts, audit })
  const positionSyncStore = new InMemoryPositionSyncStore(audit)
  const rateLimits = new InMemoryRateLimitRepository()
  const { b3Client, b3PositionClient, b3SystemClient } = createB3Clients(
    config,
    options,
  )
  const useCases = buildUseCases(
    config,
    users,
    sessions,
    connections,
    unitOfWork,
    positionSyncStore,
    rateLimits,
    b3Client,
    b3PositionClient,
    b3SystemClient,
  )

  return {
    users,
    sessions,
    connections,
    attempts,
    unitOfWork,
    positionSyncStore,
    rateLimits,
    b3Client,
    b3PositionClient,
    b3SystemClient,
    ...useCases,
  }
}

export function createDrizzleServices(config: AppConfig): AppServices {
  const client = createDatabaseClient(config.databaseUrl)
  const users = new DrizzleUserRepository(client.db)
  const sessions = new DrizzleSessionRepository(client.db)
  const connections = new DrizzleB3ConnectionRepository(client.db)
  const attempts = new DrizzleB3AuthorizationAttemptRepository(client.db)
  const unitOfWork = new DrizzleUnitOfWork(client.db)
  const positionSyncStore = new DrizzlePositionSyncStore(client.db)
  const rateLimits = new DrizzleRateLimitRepository(client.db)
  const { b3Client, b3PositionClient, b3SystemClient } =
    createB3Clients(config)
  const useCases = buildUseCases(
    config,
    users,
    sessions,
    connections,
    unitOfWork,
    positionSyncStore,
    rateLimits,
    b3Client,
    b3PositionClient,
    b3SystemClient,
  )

  return {
    users,
    sessions,
    connections,
    attempts,
    unitOfWork,
    positionSyncStore,
    rateLimits,
    b3Client,
    b3PositionClient,
    b3SystemClient,
    ...useCases,
    close: () => client.close(),
  }
}

export function createAppServices(options: {
  config: AppConfig
  mode?: 'drizzle' | 'memory'
  services?: AppServices
}): AppServices {
  if (options.services) {
    return options.services
  }

  const mode =
    options.mode ?? (options.config.nodeEnv === 'test' ? 'memory' : 'drizzle')

  return mode === 'memory'
    ? createMemoryServices(options.config)
    : createDrizzleServices(options.config)
}
