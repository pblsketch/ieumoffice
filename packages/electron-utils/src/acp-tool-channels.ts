/**
 * Shared IPC channel and global bridge key for returning renderer-executed
 * tool results to an ACP-native Basic AI Panel session (decision 0170).
 */
export const ACP_TOOL_BRIDGE_KEY = 'aiOfficeAcpTool'

export const ACP_TOOL_RESULT_CHANNEL = 'ai:acp-tool-result'

export interface AcpToolResultPayload {
  requestId: string
  callId: string
  output: string
  isError?: boolean | undefined
}

export interface PendingAcpToolResult {
  output: string
  isError?: boolean | undefined
}

export interface AcpToolBroker {
  waitForResult(options: {
    senderId: number
    requestId: string
    callId: string
    signal: AbortSignal
  }): Promise<PendingAcpToolResult>
  resolve(senderId: number, raw: unknown): boolean
  cancelRequest(requestId: string): void
}

interface PendingEntry {
  senderId: number
  requestId: string
  settle(result: PendingAcpToolResult): void
}

/**
 * Tracks in-flight renderer tool executions triggered by an ACP-native panel
 * session. Each call is bound to the originating WebContents sender id and
 * stream request id so no other tab can answer or spoof a pending tool call.
 */
export function createAcpToolBroker(): AcpToolBroker {
  const pending = new Map<string, PendingEntry>()

  return {
    waitForResult({ senderId, requestId, callId, signal }) {
      if (signal.aborted) {
        return Promise.resolve({ output: 'Cancelled', isError: true })
      }
      return new Promise<PendingAcpToolResult>((resolvePromise) => {
        const onAbort = () => {
          settle({ output: 'Cancelled', isError: true })
        }
        const settle = (result: PendingAcpToolResult) => {
          if (pending.get(callId) !== entry) return
          pending.delete(callId)
          signal.removeEventListener('abort', onAbort)
          resolvePromise(result)
        }
        const entry: PendingEntry = { senderId, requestId, settle }
        pending.set(callId, entry)
        signal.addEventListener('abort', onAbort, { once: true })
      })
    },

    resolve(senderId, raw) {
      if (!raw || typeof raw !== 'object') return false
      const payload = raw as Partial<AcpToolResultPayload>
      if (
        typeof payload.callId !== 'string' ||
        typeof payload.requestId !== 'string' ||
        typeof payload.output !== 'string'
      ) {
        return false
      }
      const entry = pending.get(payload.callId)
      if (!entry || entry.senderId !== senderId || entry.requestId !== payload.requestId) {
        return false
      }
      entry.settle({
        output: payload.output,
        ...(payload.isError === true ? { isError: true } : {}),
      })
      return true
    },

    cancelRequest(requestId) {
      for (const entry of [...pending.values()]) {
        if (entry.requestId === requestId) {
          entry.settle({ output: 'Cancelled', isError: true })
        }
      }
    },
  }
}
