import type { ContentfulStatusCode } from 'hono/utils/http-status'

export class AppError extends Error {
  override readonly name = 'AppError'

  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly headers: Readonly<Record<string, string>> = {},
  ) {
    super(message)
  }
}
