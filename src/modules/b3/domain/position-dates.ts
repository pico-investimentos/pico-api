import { createHash } from 'node:crypto'

import type { B3PositionProduct } from '../domain/position-types.js'

const SAO_PAULO = 'America/Sao_Paulo'

function formatDateParts(parts: Intl.DateTimeFormatPart[]): string {
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value

  if (!year || !month || !day) {
    throw new Error('Failed to format date in America/Sao_Paulo')
  }

  return `${year}-${month}-${day}`
}

export function calendarDateInSaoPaulo(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SAO_PAULO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)

  return formatDateParts(parts)
}

export function hashPositionNaturalKey(input: {
  documentNumber: string
  product: B3PositionProduct
  referenceDate: string
  item: Record<string, unknown>
}): string {
  const stable = JSON.stringify({
    documentNumber: input.documentNumber,
    product: input.product,
    referenceDate: input.referenceDate,
    item: sortKeys(input.item),
  })

  return createHash('sha256').update(stable).digest('hex')
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys)
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, sortKeys(nested)]),
    )
  }

  return value
}

export function extractInstrumentCode(item: Record<string, unknown>): string | null {
  const candidates = [
    item.tickerSymbol,
    item.ticker,
    item.isin,
    item.securityCode,
    item.assetCode,
    item.code,
  ]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim().slice(0, 120)
    }
  }

  return null
}

export function extractQuantity(item: Record<string, unknown>): string | null {
  const candidates = [item.quantity, item.availableQuantity, item.grossQuantity, item.amount]

  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return String(candidate)
    }
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }

  return null
}
