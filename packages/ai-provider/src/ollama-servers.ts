import type { AiOllamaServer } from './types'
import { connectTimeoutMsOf } from './watchdog'

/** Browser-safe validation shared by the settings form, file reader and IPC guard. */
export function ollamaBaseUrl(value: string): string | undefined {
  try {
    const raw = value.trim()
    if (!raw || raw.length > 2048) return undefined
    const url = new URL(raw)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      return undefined
    }
    url.hash = ''
    return url.toString().replace(/\/+$/, '')
  } catch {
    return undefined
  }
}

/** Loopback hosts a locally running Ollama listens on. */
export function isLocalOllamaUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase()
    return (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.startsWith('127.') ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host === '[::1]' ||
      host === '[::]'
    )
  } catch {
    return false
  }
}

export function normalizeOllamaServers(raw: unknown): AiOllamaServer[] {
  if (!Array.isArray(raw)) return []
  const servers: AiOllamaServer[] = []
  const ids = new Set<string>()
  const endpoints = new Set<string>()
  const text = (value: unknown, max: number) =>
    typeof value === 'string' ? value.trim().slice(0, max) : ''
  for (const entry of raw.slice(0, 100)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const e = entry as Record<string, unknown>
    const id = text(e.id, 64)
    const baseUrl = ollamaBaseUrl(typeof e.baseUrl === 'string' ? e.baseUrl : '')
    if (!id || ids.has(id) || !baseUrl) continue
    ids.add(id)
    const endpointIds: string[] = []
    for (const value of Array.isArray(e.endpointIds) ? e.endpointIds.slice(0, 2000) : []) {
      const endpointId = text(value, 64)
      if (!endpointId || endpoints.has(endpointId)) continue
      endpoints.add(endpointId)
      endpointIds.push(endpointId)
    }
    const connectTimeoutMs = connectTimeoutMsOf(e.connectTimeoutMs)
    servers.push({
      id,
      name: text(e.name, 128),
      baseUrl,
      apiKey: text(e.apiKey, 8192),
      endpointIds,
      ...(connectTimeoutMs !== undefined ? { connectTimeoutMs } : {}),
    })
  }
  return servers
}
