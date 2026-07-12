import type { Context, MiddlewareHandler, Next } from 'hono'
import { getCookie } from 'hono/cookie'

import type { AppConfig } from '../../config/env.js'
import type { AuthenticatedUser } from '../domain/types.js'
import { AppError } from '../http/app-error.js'
import type { AppBindings } from '../http/app-bindings.js'
import type { ResolveSession } from '../../modules/identity/application/auth-use-cases.js'

export type AuthVariables = {
  user: AuthenticatedUser
}

export function createRequireAuthenticatedUser(
  resolveSession: ResolveSession,
  config: Pick<AppConfig, 'sessionCookieName'>,
  now: () => Date,
): MiddlewareHandler<AppBindings> {
  return async (c: Context<AppBindings>, next: Next) => {
    const sessionToken = getCookie(c, config.sessionCookieName)
    const user = await resolveSession.execute({
      sessionToken,
      now: now(),
    })

    if (!user) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Autenticação necessária.')
    }

    c.set('user', user)
    await next()
  }
}
