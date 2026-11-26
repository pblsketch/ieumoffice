/**
 * Preload bridge exposed on `window.aiOfficeAcpTool` so `createIpcTransport` in
 * every editor renderer and Home Ask Panel can return live tool results to the
 * main-process ACP HTTP MCP server (decision 0170).
 */
import { ipcRenderer } from 'electron'
import { ACP_TOOL_RESULT_CHANNEL, type AcpToolResultPayload } from './acp-tool-channels'

export interface AcpToolBridge {
  sendResult(payload: AcpToolResultPayload): Promise<void>
}

export function acpToolBridge(): AcpToolBridge {
  return {
    sendResult: async (payload) => {
      await ipcRenderer.invoke(ACP_TOOL_RESULT_CHANNEL, {
        requestId: String(payload.requestId),
        callId: String(payload.callId),
        output: String(payload.output),
        ...(payload.isError ? { isError: true } : {}),
      })
    },
  }
}
