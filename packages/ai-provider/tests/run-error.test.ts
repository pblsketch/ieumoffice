import { describe, expect, it } from 'vitest'
import { aiStreamErrorFields, classifyAiNetworkError, isAiNetworkError } from '../src/index'
import { AiTimeoutError } from '../src/watchdog'

describe('classifyAiNetworkError and aiStreamErrorFields', () => {
  it('classifies proxy failures as proxy-error', () => {
    const err = Object.assign(new Error('fetch failed'), {
      cause: { code: 'ERR_PROXY_CONNECTION_FAILED' },
    })
    expect(classifyAiNetworkError(err)).toBe('proxy-error')
    expect(isAiNetworkError(err)).toBe(true)
    expect(aiStreamErrorFields(err)).toEqual({ errorCode: 'proxy-error' })

    const proxy407 = Object.assign(new Error('Proxy authentication required'), { status: 407 })
    expect(aiStreamErrorFields(proxy407)).toEqual({ errorCode: 'proxy-error' })
  })

  it('classifies TLS and certificate failures as cert-error', () => {
    const err = Object.assign(new Error('fetch failed'), {
      cause: { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' },
    })
    expect(classifyAiNetworkError(err)).toBe('cert-error')
    expect(aiStreamErrorFields(err)).toEqual({ errorCode: 'cert-error' })

    const selfSigned = new Error('DEPTH_ZERO_SELF_SIGNED_CERT in chain')
    expect(aiStreamErrorFields(selfSigned)).toEqual({ errorCode: 'cert-error' })
  })

  it('classifies DNS and unreachable failures as network-unreachable', () => {
    const dns = Object.assign(new Error('getaddrinfo ENOTFOUND api.example.com'), {
      code: 'ENOTFOUND',
    })
    expect(classifyAiNetworkError(dns)).toBe('network-unreachable')
    expect(aiStreamErrorFields(dns)).toEqual({ errorCode: 'network-unreachable' })
  })

  it('keeps generic socket resets as network and timeout as timeout', () => {
    const reset = Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } })
    expect(aiStreamErrorFields(reset)).toEqual({ errorCode: 'network' })
    expect(aiStreamErrorFields(new AiTimeoutError(60_000))).toEqual({
      errorCode: 'timeout',
    })
  })
})
