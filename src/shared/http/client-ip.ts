import { isIP } from 'node:net'

type HeaderReader = (name: string) => string | undefined

export function getClientIp(readHeader: HeaderReader): string {
  const candidates = [
    readHeader('x-vercel-forwarded-for'),
    readHeader('x-forwarded-for'),
    readHeader('x-real-ip'),
    readHeader('cf-connecting-ip'),
  ]

  for (const candidate of candidates) {
    const value = candidate?.split(',')[0]?.trim()
    if (value && isIP(value)) {
      return value
    }
  }

  return 'unknown'
}
