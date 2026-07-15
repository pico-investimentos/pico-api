import { request as httpsRequest } from 'node:https'
import type { IncomingMessage } from 'node:http'
import { URL } from 'node:url'

export type B3HttpResponse = Readonly<{
  status: number
  bodyText: string
}>

export type B3HttpRequestInput = Readonly<{
  url: string
  method: string
  headers?: Record<string, string>
  body?: string
  /** Attach client certificate (mTLS) for B3 gateway calls. */
  useClientCert?: boolean
  rejectUnauthorized: boolean
}>

export type B3HttpTransportOptions = Readonly<{
  certificatePem: string
  privateKeyPem: string
  timeoutMs: number
}>

function readBody(response: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    response.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    response.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    response.on('error', reject)
  })
}

export class B3HttpTransport {
  constructor(private readonly options: B3HttpTransportOptions) {}

  request(input: B3HttpRequestInput): Promise<B3HttpResponse> {
    const url = new URL(input.url)
    const timeoutMs = this.options.timeoutMs

    return new Promise((resolve, reject) => {
      const request = httpsRequest(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || 443,
          path: `${url.pathname}${url.search}`,
          method: input.method,
          headers: input.headers,
          cert: input.useClientCert ? this.options.certificatePem : undefined,
          key: input.useClientCert ? this.options.privateKeyPem : undefined,
          rejectUnauthorized: input.rejectUnauthorized,
        },
        (response) => {
          void readBody(response)
            .then((bodyText) => {
              resolve({
                status: response.statusCode ?? 0,
                bodyText,
              })
            })
            .catch(reject)
        },
      )

      request.setTimeout(timeoutMs, () => {
        request.destroy(new Error(`B3 HTTP request timed out after ${timeoutMs}ms`))
      })

      request.on('error', reject)

      if (input.body) {
        request.write(input.body)
      }

      request.end()
    })
  }
}
