/**
 * The mobile PDF engine in the calling thread, with the same operations and
 * the same error shape as the worker client. For tests (jsdom has no Worker):
 * the app uses the worker (client.ts). Kept out of index.ts so the page bundle
 * does not carry a second copy of the engine.
 */
import { engineFrom, type PdfEngine } from './client'
import type { PdfEngineOp } from './core'
import { handleEngineRequest } from './dispatch'
import type { PdfEngineRequest } from './protocol'
import { errorFrom } from './protocol'

export function createInThreadPdfEngine(): PdfEngine {
  let nextId = 1
  const call = async (op: PdfEngineOp, args: unknown[]): Promise<unknown> => {
    const response = await handleEngineRequest({ id: nextId++, op, args } as PdfEngineRequest)
    if (!response.ok) throw errorFrom(response.error)
    return response.result
  }
  return engineFrom(call, () => {})
}
