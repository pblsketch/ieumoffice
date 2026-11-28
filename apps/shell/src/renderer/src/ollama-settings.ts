import {
  newCustomEndpointId,
  OLLAMA_CONNECT_TIMEOUT_MS,
  prettyModelName,
  removeCustomEndpoint,
  resolveCustomEndpoints,
  selectCustomEndpoint,
  upsertCustomEndpoint,
} from '@genoffice/ai-provider/browser'
import type { OllamaEffortPreset, AiOllamaServer, AiSettings } from '@genoffice/ai-provider/browser'

export const LOCAL_OLLAMA_URL = 'http://localhost:11434/v1'

export function defaultOllamaServer(name: string): AiOllamaServer {
  return {
    id: 'ollama-local',
    name,
    baseUrl: LOCAL_OLLAMA_URL,
    apiKey: '',
    endpointIds: [],
    connectTimeoutMs: OLLAMA_CONNECT_TIMEOUT_MS,
  }
}

/** An absent list is a first visit; an empty list means the user removed all servers. */
export function withDefaultOllamaServer(settings: AiSettings, name: string): AiSettings {
  if (settings.ollamaServers !== undefined) return settings
  return {
    ...settings,
    ollamaServers: [defaultOllamaServer(name)],
  }
}

export function saveOllamaServer(settings: AiSettings, server: AiOllamaServer): AiSettings {
  let next = resolveCustomEndpoints(settings)
  const previous = next.ollamaServers?.find((s) => s.id === server.id)
  const updated = { ...server, endpointIds: previous?.endpointIds ?? [] }
  for (const endpoint of next.customEndpoints ?? []) {
    if (!updated.endpointIds.includes(endpoint.id)) continue
    const prevEffort = endpoint.effort
    const pretty = prettyModelName(endpoint.model)
    const prevExpectedName = prevEffort
      ? `${previous?.name} / ${pretty} ${prevEffort}`.slice(0, 128)
      : `${previous?.name} / ${endpoint.model}`.slice(0, 128)
    const newName = prevEffort
      ? `${server.name} / ${pretty} ${prevEffort}`.slice(0, 128)
      : `${server.name} / ${endpoint.model}`.slice(0, 128)
    next = upsertCustomEndpoint(next, {
      ...endpoint,
      baseUrl: server.baseUrl,
      apiKey: server.apiKey,
      connectTimeoutMs: server.connectTimeoutMs ?? OLLAMA_CONNECT_TIMEOUT_MS,
      name: endpoint.name === prevExpectedName ? newName : endpoint.name,
    })
  }
  return {
    ...next,
    ollamaServers: previous
      ? next.ollamaServers!.map((s) => (s.id === server.id ? updated : s))
      : [...(next.ollamaServers ?? []), updated],
  }
}

export function registerOllamaModel(
  settings: AiSettings,
  serverId: string,
  model: string,
  effort?: OllamaEffortPreset,
  vision?: boolean,
): AiSettings {
  let next = resolveCustomEndpoints(settings)
  const server = next.ollamaServers?.find((s) => s.id === serverId)
  if (!server || !model.trim()) return settings
  const targetEffort = effort ?? 'medium'
  if (
    next.customEndpoints?.some(
      (e) =>
        server.endpointIds.includes(e.id) &&
        e.model === model &&
        (e.effort ?? 'medium') === targetEffort,
    )
  ) {
    return settings
  }
  const active = next.customEndpoint
  const id = newCustomEndpointId()
  const pretty = prettyModelName(model)
  const name = effort
    ? `${server.name} / ${pretty} ${effort}`.slice(0, 128)
    : `${server.name} / ${model}`.slice(0, 128)
  next = upsertCustomEndpoint(next, {
    id,
    name,
    baseUrl: server.baseUrl,
    apiKey: server.apiKey,
    model,
    models: [model],
    ...(effort ? { effort } : {}),
    connectTimeoutMs: server.connectTimeoutMs ?? OLLAMA_CONNECT_TIMEOUT_MS,
    ...(vision !== undefined ? { vision } : {}),
  })
  // Adding to the catalogue must not switch an already selected Custom model.
  if (active) next = selectCustomEndpoint(next, active)
  return {
    ...next,
    ollamaServers: next.ollamaServers!.map((s) =>
      s.id === serverId ? { ...s, endpointIds: [...s.endpointIds, id] } : s,
    ),
  }
}

export function unregisterOllamaModel(
  settings: AiSettings,
  serverId: string,
  endpointId: string,
): AiSettings {
  const server = settings.ollamaServers?.find((s) => s.id === serverId)
  if (!server?.endpointIds.includes(endpointId)) return settings
  const next = removeCustomEndpoint(resolveCustomEndpoints(settings), endpointId)
  return {
    ...next,
    ollamaServers: next.ollamaServers!.map((s) =>
      s.id === serverId
        ? { ...s, endpointIds: s.endpointIds.filter((id) => id !== endpointId) }
        : s,
    ),
  }
}

export function removeOllamaServer(settings: AiSettings, serverId: string): AiSettings {
  let next = settings
  const server = settings.ollamaServers?.find((s) => s.id === serverId)
  if (!server) return settings
  for (const id of server.endpointIds) next = unregisterOllamaModel(next, serverId, id)
  return { ...next, ollamaServers: next.ollamaServers?.filter((s) => s.id !== serverId) }
}
