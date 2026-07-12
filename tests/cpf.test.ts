import { describe, expect, it } from 'vitest'

import { isValidCpf, normalizeCpf } from '../src/shared/crypto/security.js'

describe('CPF validation', () => {
  it('accepts a valid CPF', () => {
    expect(isValidCpf('390.533.447-05')).toBe(true)
    expect(normalizeCpf('390.533.447-05')).toBe('39053344705')
  })

  it('rejects repeated digits', () => {
    expect(isValidCpf('11111111111')).toBe(false)
  })
})
