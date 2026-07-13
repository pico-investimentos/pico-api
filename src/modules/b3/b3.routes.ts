import { Hono } from 'hono'
import { z } from 'zod'

import type { AppConfig } from '../../config/env.js'
import type { ConfirmB3Authorization } from './application/confirm-b3-authorization.js'
import type { GetB3Connection } from './application/get-b3-connection.js'
import type { RevokeB3Authorization } from './application/revoke-b3-authorization.js'
import type { StartB3Authorization } from './application/start-b3-authorization.js'
import type { ResolveSession } from '../identity/application/auth-use-cases.js'
import { createRequireAuthenticatedUser } from '../../shared/auth/require-authenticated-user.js'
import { AppError } from '../../shared/http/app-error.js'
import type { AppBindings } from '../../shared/http/app-bindings.js'

const idempotencyKeySchema = z.string().uuid()
const revokeBodySchema = z.object({
  password: z.string().min(8).max(128),
})

type B3RouteDependencies = {
  config: AppConfig
  now: () => Date
  resolveSession: ResolveSession
  startB3Authorization: StartB3Authorization
  getB3Connection: GetB3Connection
  confirmB3Authorization: ConfirmB3Authorization
  revokeB3Authorization: RevokeB3Authorization
}

export function createB3Routes(dependencies: B3RouteDependencies) {
  const routes = new Hono<AppBindings>()
  const requireAuth = createRequireAuthenticatedUser(
    dependencies.resolveSession,
    dependencies.config,
    dependencies.now,
  )

  routes.get('/integrations/b3/connection', requireAuth, async (c) => {
    const user = c.get('user')

    if (!user) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Autenticação necessária.')
    }

    const connection = await dependencies.getB3Connection.execute(user.id)

    c.header('Cache-Control', 'no-store')
    c.header('Pragma', 'no-cache')

    return c.json({ data: connection })
  })

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

  routes.post('/integrations/b3/connection/confirmation', requireAuth, async (c) => {
    const user = c.get('user')

    if (!user) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Autenticação necessária.')
    }

    const result = await dependencies.confirmB3Authorization.execute({
      userId: user.id,
      requestId: c.get('requestId'),
      now: dependencies.now(),
    })

    c.header('Cache-Control', 'no-store')
    c.header('Pragma', 'no-cache')

    return c.json({ data: result })
  })

  routes.post('/integrations/b3/connection/revocation', requireAuth, async (c) => {
    const user = c.get('user')

    if (!user) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Autenticação necessária.')
    }

    const parsed = revokeBodySchema.safeParse(await c.req.json().catch(() => null))

    if (!parsed.success) {
      throw new AppError(422, 'VALIDATION_ERROR', 'Informe a senha da sua conta Pico.')
    }

    const result = await dependencies.revokeB3Authorization.execute({
      userId: user.id,
      password: parsed.data.password,
      requestId: c.get('requestId'),
      now: dependencies.now(),
    })

    c.header('Cache-Control', 'no-store')
    c.header('Pragma', 'no-cache')

    return c.json({ data: result })
  })

  return routes
}
