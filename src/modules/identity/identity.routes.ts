import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { z } from 'zod'

import type { AppConfig } from '../../config/env.js'
import type { LoginUser, LogoutUser, ResolveSession } from './application/auth-use-cases.js'
import { clearSessionCookie, setSessionCookie } from '../../shared/auth/session-cookie.js'
import { createRequireAuthenticatedUser } from '../../shared/auth/require-authenticated-user.js'
import { AppError } from '../../shared/http/app-error.js'
import type { AppBindings } from '../../shared/http/app-bindings.js'

const loginBodySchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(128),
})

type IdentityRouteDependencies = {
  config: AppConfig
  now: () => Date
  loginUser: LoginUser
  logoutUser: LogoutUser
  resolveSession: ResolveSession
}

export function createIdentityRoutes(dependencies: IdentityRouteDependencies) {
  const routes = new Hono<AppBindings>()
  const requireAuth = createRequireAuthenticatedUser(
    dependencies.resolveSession,
    dependencies.config,
    dependencies.now,
  )

  routes.post('/auth/login', async (c) => {
    const parsed = loginBodySchema.safeParse(await c.req.json().catch(() => null))

    if (!parsed.success) {
      throw new AppError(422, 'VALIDATION_ERROR', 'Os dados enviados são inválidos.')
    }

    const result = await dependencies.loginUser.execute({
      email: parsed.data.email,
      password: parsed.data.password,
      now: dependencies.now(),
    })

    setSessionCookie(c, dependencies.config, result.sessionToken, result.expiresAt)

    return c.json({
      data: {
        user: {
          id: result.user.id,
          email: result.user.email,
          hasCpf: Boolean(result.user.cpf),
        },
      },
    })
  })

  routes.post('/auth/logout', async (c) => {
    const sessionToken = getCookie(c, dependencies.config.sessionCookieName)
    await dependencies.logoutUser.execute(sessionToken)
    clearSessionCookie(c, dependencies.config)
    return c.body(null, 204)
  })

  routes.get('/me', requireAuth, (c) => {
    const user = c.get('user')

    if (!user) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Autenticação necessária.')
    }

    return c.json({
      data: {
        id: user.id,
        email: user.email,
        hasCpf: Boolean(user.cpf),
        isActive: user.isActive,
      },
    })
  })

  return routes
}
