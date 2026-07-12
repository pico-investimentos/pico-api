import { Hono } from 'hono'
import { z } from 'zod'

import type { AppConfig } from '../../config/env.js'
import type { StartB3Authorization } from './application/start-b3-authorization.js'
import type { ResolveSession } from '../identity/application/auth-use-cases.js'
import { createRequireAuthenticatedUser } from '../../shared/auth/require-authenticated-user.js'
import { AppError } from '../../shared/http/app-error.js'
import type { AppBindings } from '../../shared/http/app-bindings.js'

const idempotencyKeySchema = z.string().uuid()

type B3RouteDependencies = {
  config: AppConfig
  now: () => Date
  resolveSession: ResolveSession
  startB3Authorization: StartB3Authorization
}

export function createB3Routes(dependencies: B3RouteDependencies) {
  const routes = new Hono<AppBindings>()
  const requireAuth = createRequireAuthenticatedUser(
    dependencies.resolveSession,
    dependencies.config,
    dependencies.now,
  )

  routes.post('/integrations/b3/authorization-attempts', requireAuth, async (c) => {
    const user = c.get('user')

    if (!user) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Autenticação necessária.')
    }

    const idempotencyKey = c.req.header('Idempotency-Key')
    const parsedKey = idempotencyKeySchema.safeParse(idempotencyKey)

    if (!parsedKey.success) {
      throw new AppError(
        422,
        'VALIDATION_ERROR',
        'Informe um Idempotency-Key UUID válido.',
      )
    }

    // Ignore any client-supplied identity fields in the body.
    await c.req.json().catch(() => ({}))

    const result = await dependencies.startB3Authorization.execute({
      userId: user.id,
      idempotencyKey: parsedKey.data,
      requestId: c.get('requestId'),
      now: dependencies.now(),
    })

    c.header('Cache-Control', 'no-store')
    c.header('Pragma', 'no-cache')

    return c.json(
      {
        data: {
          attemptId: result.attemptId,
          connectionStatus: result.connectionStatus,
          authorizationUrl: result.authorizationUrl,
        },
      },
      result.reused ? 200 : 201,
    )
  })

  return routes
}
