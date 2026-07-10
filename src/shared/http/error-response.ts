import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

import type { AppConfig } from '../../config/env.js'
import type { AppBindings } from './app-bindings.js'
import { AppError } from './app-error.js'

type ErrorDescriptor = {
  code: string
  message: string
}

export function createErrorPayload(
  descriptor: ErrorDescriptor,
  requestId: string,
) {
  return {
    error: {
      ...descriptor,
      requestId,
    },
  }
}

function describeHttpError(status: number): ErrorDescriptor {
  switch (status) {
    case 400:
      return { code: 'BAD_REQUEST', message: 'A requisição é inválida.' }
    case 401:
      return { code: 'UNAUTHORIZED', message: 'Autenticação necessária.' }
    case 403:
      return { code: 'FORBIDDEN', message: 'Acesso não autorizado.' }
    case 404:
      return { code: 'NOT_FOUND', message: 'Recurso não encontrado.' }
    case 405:
      return { code: 'METHOD_NOT_ALLOWED', message: 'Método não permitido.' }
    case 413:
      return { code: 'PAYLOAD_TOO_LARGE', message: 'O corpo da requisição excede o limite.' }
    case 422:
      return { code: 'VALIDATION_ERROR', message: 'Os dados enviados são inválidos.' }
    case 429:
      return { code: 'TOO_MANY_REQUESTS', message: 'Muitas tentativas. Tente novamente depois.' }
    default:
      return { code: 'REQUEST_FAILED', message: 'Não foi possível concluir a requisição.' }
  }
}

export function notFoundResponse(c: Context<AppBindings>) {
  return c.json(
    createErrorPayload(describeHttpError(404), c.get('requestId')),
    404,
  )
}

export function errorResponse(
  error: Error,
  c: Context<AppBindings>,
  config: AppConfig,
): Response {
  const requestId = c.get('requestId')

  if (error instanceof AppError) {
    return c.json(
      createErrorPayload({ code: error.code, message: error.message }, requestId),
      error.status,
    )
  }

  if (error instanceof HTTPException && error.status < 500) {
    return c.json(
      createErrorPayload(describeHttpError(error.status), requestId),
      error.status as ContentfulStatusCode,
    )
  }

  if (config.logLevel !== 'silent') {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'unhandled_error',
        requestId,
        errorType: error.name,
      }),
    )
  }

  return c.json(
    createErrorPayload(
      { code: 'INTERNAL_ERROR', message: 'Ocorreu um erro interno.' },
      requestId,
    ),
    500,
  )
}
