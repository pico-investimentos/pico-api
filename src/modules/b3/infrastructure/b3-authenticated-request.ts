import type {
  B3HttpRequestInput,
  B3HttpResponse,
} from './b3-http-transport.js'
import type { B3HttpStack } from './create-b3-http-stack.js'

export async function requestWithB3AccessToken(
  stack: B3HttpStack,
  createRequest: (accessToken: string) => B3HttpRequestInput,
): Promise<B3HttpResponse> {
  const accessToken = await stack.tokenProvider.getAccessToken()
  const response = await stack.transport.request(createRequest(accessToken))
  if (response.status !== 401) {
    return response
  }

  stack.tokenProvider.invalidate(accessToken)
  const refreshedToken = await stack.tokenProvider.getAccessToken()
  return stack.transport.request(createRequest(refreshedToken))
}
