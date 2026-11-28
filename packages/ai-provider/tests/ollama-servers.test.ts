import { describe, expect, it } from 'vitest'
import { isLocalOllamaUrl } from '../src/ollama-servers'

describe('isLocalOllamaUrl', () => {
  it('matches loopback hosts', () => {
    expect(isLocalOllamaUrl('http://localhost:11434/v1')).toBe(true)
    expect(isLocalOllamaUrl('https://localhost/v1')).toBe(true)
    expect(isLocalOllamaUrl('http://foo.localhost:11434/v1')).toBe(true)
    expect(isLocalOllamaUrl('http://127.0.0.1:11434/v1')).toBe(true)
    expect(isLocalOllamaUrl('http://127.10.20.30/v1')).toBe(true)
    expect(isLocalOllamaUrl('http://0.0.0.0:11434/v1')).toBe(true)
    expect(isLocalOllamaUrl('http://[::1]:11434/v1')).toBe(true)
  })

  it('rejects remote hosts and invalid input', () => {
    expect(isLocalOllamaUrl('http://192.168.1.10:11434/v1')).toBe(false)
    expect(isLocalOllamaUrl('http://ollama.example.com/v1')).toBe(false)
    expect(isLocalOllamaUrl('http://localhost.evil.test/v1')).toBe(false)
    expect(isLocalOllamaUrl('not a url')).toBe(false)
    expect(isLocalOllamaUrl('')).toBe(false)
  })
})
