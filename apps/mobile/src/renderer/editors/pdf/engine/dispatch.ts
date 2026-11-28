/**
 * Runs one engine request against `pdfEngineCore` and answers it, never
 * throwing: an error becomes the response's error fields.
 */
import { pdfEngineCore, type PdfEngineOp } from './core'
import type { PdfEngineRequest, PdfEngineResponse } from './protocol'
import { errorFields } from './protocol'

const OPS = new Set<string>(Object.keys(pdfEngineCore))

export async function handleEngineRequest(request: PdfEngineRequest): Promise<PdfEngineResponse> {
  const { id, op, args } = request
  try {
    if (!OPS.has(op)) throw new Error(`pdf engine: unknown operation ${String(op)}`)
    const run = pdfEngineCore[op as PdfEngineOp] as (...a: unknown[]) => Promise<unknown>
    const result = await run(...(args as unknown[]))
    return { id, ok: true, result }
  } catch (error) {
    return { id, ok: false, error: errorFields(error) }
  }
}
