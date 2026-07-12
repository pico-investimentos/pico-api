import type { AppConfig } from '../../../config/env.js'
import {
  createSessionToken,
  hashSha256,
  verifyPassword,
} from '../../../shared/crypto/security.js'
import type { AuthenticatedUser } from '../../../shared/domain/types.js'
import { AppError } from '../../../shared/http/app-error.js'
import type { SessionRepository } from '../domain/session-repository.js'
import {
  toAuthenticatedUser,
  type UserRepository,
} from '../domain/user-repository.js'

export class LoginUser {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly config: Pick<AppConfig, 'sessionTtlHours'>,
  ) {}

  async execute(input: {
    email: string
    password: string
    now?: Date
  }): Promise<{ user: AuthenticatedUser; sessionToken: string; expiresAt: Date }> {
    const now = input.now ?? new Date()
    const user = await this.users.findByEmail(input.email.trim().toLowerCase())

    if (!user || !user.isActive) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'E-mail ou senha inválidos.')
    }

    const passwordMatches = await verifyPassword(input.password, user.passwordHash)

    if (!passwordMatches) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'E-mail ou senha inválidos.')
    }

    const sessionToken = createSessionToken()
    const expiresAt = new Date(now.getTime() + this.config.sessionTtlHours * 60 * 60 * 1000)

    await this.sessions.create({
      userId: user.id,
      tokenHash: hashSha256(sessionToken),
      expiresAt,
    })

    return {
      user: toAuthenticatedUser(user),
      sessionToken,
      expiresAt,
    }
  }
}

export class LogoutUser {
  constructor(private readonly sessions: SessionRepository) {}

  async execute(sessionToken: string | undefined): Promise<void> {
    if (!sessionToken) {
      return
    }

    await this.sessions.deleteByTokenHash(hashSha256(sessionToken))
  }
}

export class ResolveSession {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
  ) {}

  async execute(input: {
    sessionToken: string | undefined
    now?: Date
  }): Promise<AuthenticatedUser | null> {
    if (!input.sessionToken) {
      return null
    }

    const now = input.now ?? new Date()
    const session = await this.sessions.findByTokenHash(hashSha256(input.sessionToken))

    if (!session || session.expiresAt <= now) {
      if (session) {
        await this.sessions.deleteByTokenHash(session.tokenHash)
      }
      return null
    }

    const user = await this.users.findById(session.userId)

    if (!user || !user.isActive) {
      return null
    }

    return toAuthenticatedUser(user)
  }
}
