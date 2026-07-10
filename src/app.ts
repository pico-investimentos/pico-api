import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { csrf } from 'hono/csrf'
import { requestId } from 'hono/request-id'
import { secureHeaders } from 'hono/secure-headers'

import { createApiRoutes } from './api.js'
import { loadConfig, type AppConfig } from './config/env.js'
import type { AppBindings } from './shared/http/app-bindings.js'
import {
  createErrorPayload,
  errorResponse,
  notFoundResponse,
} from './shared/http/error-response.js'
import { accessLog } from './shared/observability/access-log.js'

type CreateAppOptions = {
  config?: AppConfig
  now?: () => Date
}

const MAX_JSON_BODY_SIZE = 1024 * 1024

export function createApp(options: CreateAppOptions = {}) {
  const config = options.config ?? loadConfig()
  const now = options.now ?? (() => new Date())
  const baseApp = new Hono<AppBindings>()

  baseApp.use('*', requestId({ limitLength: 64 }))
  baseApp.use('*', async (c, next) => {
    c.header('X-Request-Id', c.get('requestId'))
    await next()
  })
  baseApp.use('*', accessLog(config))
  baseApp.use('*', secureHeaders({ xFrameOptions: 'DENY' }))
  baseApp.use(
    '*',
    cors({
      origin: (origin) => (config.appOrigins.includes(origin) ? origin : undefined),
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Authorization', 'Content-Type', 'X-CSRF-Token', 'X-Request-Id'],
      exposeHeaders: ['X-Request-Id'],
      credentials: true,
      maxAge: 600,
    }),
  )
  baseApp.use(
    '*',
    csrf({
      origin: [...config.appOrigins],
      secFetchSite: ['same-origin', 'none'],
    }),
  )
  baseApp.use(
    '*',
    bodyLimit({
      maxSize: MAX_JSON_BODY_SIZE,
      onError: (c) =>
        c.json(
          createErrorPayload(
            {
              code: 'PAYLOAD_TOO_LARGE',
              message: 'O corpo da requisição excede o limite.',
            },
            c.get('requestId'),
          ),
          413,
        ),
    }),
  )
  baseApp.use('*', async (c, next) => {
    await next()

    if (!c.res.headers.has('Cache-Control')) {
      c.header('Cache-Control', 'no-store')
    }
  })

  const app = baseApp
    .get('/', (c) =>
      c.json({
        service: 'pico-investimentos-api',
        version: '0.1.0',
      }),
    )
    .route('/api/v1', createApiRoutes({ now }))

  app.notFound(notFoundResponse)
  app.onError((error, c) => errorResponse(error, c, config))

  return app
}
