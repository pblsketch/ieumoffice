/**
 * Messages between the engine client (calling thread) and the engine worker.
 * One request carries an operation of `PdfEngineCore` and its arguments; the
 * answer carries the result or the error as plain fields, so the client can
 * rebuild an `Error` whose message is exactly the PC code's (for example
 * `save-verify-failed pages=2: …`).
 */
import type { PdfEngineCore, PdfEngineOp } from './core'

/** Every operation the engine answers, in the order of `pdfEngineCore` */
export const PDF_ENGINE_OPS = [
  'saveBytes',
  'applyEdits',
  'hasEdits',
  'insertPdf',
  'insertBlankPage',
  'blankPdf',
  'canDrawText',
  'listEditFonts',
  'validateTextEdits',
  'flattenAnnots',
  'stripCommentAnnots',
] as const satisfies readonly PdfEngineOp[]

// Compile-time check that the list names every operation of the core
type MissingOps = Exclude<PdfEngineOp, (typeof PDF_ENGINE_OPS)[number]>
const allOpsListed: [MissingOps] extends [never] ? true : MissingOps = true
void allOpsListed

export interface PdfEngineRequest<Op extends PdfEngineOp = PdfEngineOp> {
  id: number
  op: Op
  args: Parameters<PdfEngineCore[Op]>
}

export interface PdfEngineErrorFields {
  message: string
  name: string
  code?: string
}

export type PdfEngineResponse =
  { id: number; ok: true; result: unknown } | { id: number; ok: false; error: PdfEngineErrorFields }

export function errorFields(error: unknown): PdfEngineErrorFields {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code
    return {
      message: error.message,
      name: error.name,
      ...(typeof code === 'string' ? { code } : {}),
    }
  }
  return { message: String(error), name: 'Error' }
}

export function errorFrom(fields: PdfEngineErrorFields): Error {
  const error = new Error(fields.message)
  error.name = fields.name
  if (fields.code !== undefined) Object.assign(error, { code: fields.code })
  return error
}

/** ArrayBuffers of the Uint8Arrays in a result, to move them out instead of copying */
export function transferablesOf(value: unknown, out: ArrayBuffer[] = []): ArrayBuffer[] {
  if (value instanceof Uint8Array) {
    const buffer = value.buffer
    if (buffer instanceof ArrayBuffer && !out.includes(buffer)) out.push(buffer)
  } else if (Array.isArray(value)) {
    for (const item of value) transferablesOf(item, out)
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) transferablesOf(item, out)
  }
  return out
}
