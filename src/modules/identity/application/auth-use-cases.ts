import type { AppConfig } from '../../../config/env.js'
import {
  createSessionToken,
  hashPassword,
  hashSha256,
  needsPasswordRehash,
  verifyPassword,
} from '../../../shared/crypto/security.js'
import type { AuthenticatedUser } from '../../../shared/domain/types.js'
import { AppError } from '../../../shared/http/app-error.js'
import {
  createRateLimitKey,
  enforceRateLimit,
} from '../../../shared/security/rate-limit.js'
import type { RateLimitRepository } from '../../../shared/security/rate-limit-repository.js'
import type { SessionRepository } from '../domain/session-repository.js'
import {
  toAuthenticatedUser,
  type UserRepository,
} from '../domain/user-repository.js'

const LOGIN_WINDOW_MS = 15 * 60 * 1000
const LOGIN_ACCOUNT_LIMIT = 5
const LOGIN_IP_LIMIT = 20
const LOGIN_BLOCK_MS = 30 * 60 * 1000
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$L19xUqChHTGFFGBKw4ftfw$70LeanaXzNVvd6/GHQPjURk8IdsCcsqQfO345GcsBMQ'

export class LoginUser {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly rateLimits: RateLimitRepository,
    private readonly config: Pick<
      AppConfig,
      'rateLimitKeySecret' | 'sessionTtlHours'
    >,
  ) {}

  async execute(input: {
    email: string
    password: string
    ipAddress: string
    now?: Date
  }): Promise<{ user: AuthenticatedUser; sessionToken: string; expiresAt: Date }> {
    const now = input.now ?? new Date()
    const email = input.email.trim().toLowerCase()
    const accountKey = createRateLimitKey(
      this.config.rateLimitKeySecret,
      'login:account',
      email,
    )
    await enforceRateLimit(this.rateLimits, {
      keyHash: createRateLimitKey(
        this.config.rateLimitKeySecret,
        'login:ip',
        input.ipAddress,
      ),
      limit: LOGIN_IP_LIMIT,
      windowMs: LOGIN_WINDOW_MS,
      blockMs: LOGIN_BLOCK_MS,
      now,
    })
    await enforceRateLimit(this.rateLimits, {
      keyHash: accountKey,
      limit: LOGIN_ACCOUNT_LIMIT,
      windowMs: LOGIN_WINDOW_MS,
      blockMs: LOGIN_BLOCK_MS,
      now,
    })

    const user = await this.users.findByEmail(email)
    const passwordMatches = await verifyPassword(
      input.password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    )

    if (!user || !user.isActive || !passwordMatches) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'E-mail ou senha inválidos.')
    }

    await this.rateLimits.reset(accountKey)
    if (needsPasswordRehash(user.passwordHash)) {
      await this.users.updatePasswordHash({
        id: user.id,
        passwordHash: await hashPassword(input.password),
      })
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
