import type { AppConfig } from '../config/env.js'
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
  UnitOfWork,
} from '../modules/b3/domain/b3-repositories.js'
import { createDatabaseClient } from './database/client.js'
import {
  DrizzleB3AuthorizationAttemptRepository,
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
  attempts: B3AuthorizationAttemptRepository
  unitOfWork: UnitOfWork
  loginUser: LoginUser
  logoutUser: LogoutUser
  resolveSession: ResolveSession
  startB3Authorization: StartB3Authorization
  close?: () => Promise<void>
}

function buildUseCases(
  config: AppConfig,
  users: UserRepository,
  sessions: SessionRepository,
  attempts: B3AuthorizationAttemptRepository,
  unitOfWork: UnitOfWork,
): Omit<AppServices, 'users' | 'sessions' | 'attempts' | 'unitOfWork' | 'close'> {
  return {
    loginUser: new LoginUser(users, sessions, config),
    logoutUser: new LogoutUser(sessions),
    resolveSession: new ResolveSession(users, sessions),
    startB3Authorization: new StartB3Authorization(
      users,
      attempts,
      unitOfWork,
      config.b3,
    ),
  }
}

export function createMemoryServices(config: AppConfig): AppServices {
  const users = new InMemoryUserRepository()
  const sessions = new InMemorySessionRepository()
  const connections = new InMemoryB3ConnectionRepository()
  const attempts = new InMemoryB3AuthorizationAttemptRepository()
  const audit = new InMemoryAuditRepository()
  const unitOfWork = new InMemoryUnitOfWork({ connections, attempts, audit })
  const useCases = buildUseCases(config, users, sessions, attempts, unitOfWork)

  return {
    users,
    sessions,
    attempts,
    unitOfWork,
    ...useCases,
  }
}

export function createDrizzleServices(config: AppConfig): AppServices {
  const client = createDatabaseClient(config.databaseUrl)
  const users = new DrizzleUserRepository(client.db)
  const sessions = new DrizzleSessionRepository(client.db)
  const attempts = new DrizzleB3AuthorizationAttemptRepository(client.db)
  const unitOfWork = new DrizzleUnitOfWork(client.db)
  const useCases = buildUseCases(config, users, sessions, attempts, unitOfWork)

  return {
    users,
    sessions,
    attempts,
    unitOfWork,
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
