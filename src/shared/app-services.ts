import type { AppConfig } from '../config/env.js'
import { ConfirmB3Authorization } from '../modules/b3/application/confirm-b3-authorization.js'
import { GetB3Connection } from '../modules/b3/application/get-b3-connection.js'
import { RevokeB3Authorization } from '../modules/b3/application/revoke-b3-authorization.js'
import { StartB3Authorization } from '../modules/b3/application/start-b3-authorization.js'
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
import {
  HttpB3InvestorAuthorizationClient,
  InMemoryB3InvestorAuthorizationClient,
  type B3InvestorAuthorizationClient,
} from '../modules/b3/infrastructure/b3-investor-authorization-client.js'
import { loadB3AccessSecrets } from '../modules/b3/infrastructure/load-b3-secrets.js'
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

export type AppServices = {
  users: UserRepository
  sessions: SessionRepository
  connections: B3ConnectionRepository
  attempts: B3AuthorizationAttemptRepository
  unitOfWork: UnitOfWork
  b3Client: B3InvestorAuthorizationClient
  loginUser: LoginUser
  logoutUser: LogoutUser
  resolveSession: ResolveSession
  startB3Authorization: StartB3Authorization
  getB3Connection: GetB3Connection
  confirmB3Authorization: ConfirmB3Authorization
  revokeB3Authorization: RevokeB3Authorization
  close?: () => Promise<void>
}

export function createB3InvestorAuthorizationClient(
  config: AppConfig,
  options?: { authorizedDocuments?: ReadonlySet<string> },
): B3InvestorAuthorizationClient {
  if (config.nodeEnv === 'test' || !config.b3.secretsDir) {
    return new InMemoryB3InvestorAuthorizationClient(options?.authorizedDocuments)
  }

  return new HttpB3InvestorAuthorizationClient(
    config.b3,
    loadB3AccessSecrets(config.b3.secretsDir),
  )
}

function buildUseCases(
  config: AppConfig,
  users: UserRepository,
  sessions: SessionRepository,
  connections: B3ConnectionRepository,
  unitOfWork: UnitOfWork,
  b3Client: B3InvestorAuthorizationClient,
): Omit<
  AppServices,
  | 'users'
  | 'sessions'
  | 'connections'
  | 'attempts'
  | 'unitOfWork'
  | 'b3Client'
  | 'close'
> {
  return {
    loginUser: new LoginUser(users, sessions, config),
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
      b3Client,
      config.b3,
    ),
  }
}

export function createMemoryServices(
  config: AppConfig,
  options?: { authorizedDocuments?: ReadonlySet<string> },
): AppServices {
  const users = new InMemoryUserRepository()
  const sessions = new InMemorySessionRepository()
  const connections = new InMemoryB3ConnectionRepository()
  const attempts = new InMemoryB3AuthorizationAttemptRepository()
  const audit = new InMemoryAuditRepository()
  const unitOfWork = new InMemoryUnitOfWork({ connections, attempts, audit })
  const b3Client = createB3InvestorAuthorizationClient(config, options)
  const useCases = buildUseCases(
    config,
    users,
    sessions,
    connections,
    unitOfWork,
    b3Client,
  )

  return {
    users,
    sessions,
    connections,
    attempts,
    unitOfWork,
    b3Client,
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
  const b3Client = createB3InvestorAuthorizationClient(config)
  const useCases = buildUseCases(
    config,
    users,
    sessions,
    connections,
    unitOfWork,
    b3Client,
  )

  return {
    users,
    sessions,
    connections,
    attempts,
    unitOfWork,
    b3Client,
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
