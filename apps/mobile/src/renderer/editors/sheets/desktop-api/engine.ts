import {
  SHEETS_ENGINE_PROTOCOL_VERSION,
  sheetsEngineRequest,
} from '@genoffice/mobile-bridge/sheets'
import type { MobileClient } from '@genoffice/mobile-bridge/transport'

/** What the engine calls need from the app's client (the Tauri transport only). */
export type SheetsEngineClient = Pick<MobileClient, 'transport'>

/** An `ok: false` engine answer. The message is the engine's own, as the desktop client reports it. */
export class SheetsEngineError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'SheetsEngineError'
    this.code = code
  }
}

/**
 * Sends one engine command and resolves with its `result`. The desktop sidecar
 * client (apps/sheets/src/main/xlsx-sidecar-client.ts) does the same: a fresh
 * request id per call, the protocol version on every line, and an `ok: false`
 * answer rejects with the engine's message.
 */
export async function callSheetsEngine(
  client: SheetsEngineClient,
  command: string,
  fields: Readonly<Record<string, unknown>> = {},
): Promise<unknown> {
  const response = await sheetsEngineRequest(client, {
    ...fields,
    version: SHEETS_ENGINE_PROTOCOL_VERSION,
    requestId: crypto.randomUUID(),
    command,
  })
  if (response.ok) return response.result
  throw new SheetsEngineError(
    response.error?.code ?? 'engine_error',
    response.error?.message ?? 'XLSX sidecar request failed.',
  )
}
