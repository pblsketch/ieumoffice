/**
 * PDFium (wasm about 4.6 MB) and qpdf (wasm about 1.3 MB) from the app
 * bundle, for the engine worker. Each glue script is its own chunk, loaded
 * the first time a tool needs it; the wasm is read from its bundled asset
 * URL, never from the network.
 */
import pdfiumWasmUrl from '@embedpdf/pdfium/pdfium.wasm?url'
import qpdfWasmUrl from '@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url'
import type { CreateQpdf } from '@genoffice/pdf-ops'
import { initPdfium, type EnginePdfium, type QpdfKit } from './core'

export async function loadBundledPdfium(): Promise<EnginePdfium> {
  const { init } = await import('@embedpdf/pdfium')
  return initPdfium(init as (overrides: object) => Promise<unknown>, {
    locateFile: () => pdfiumWasmUrl,
  })
}

export async function loadBundledQpdf(): Promise<QpdfKit> {
  // CommonJS glue: the bundle gives it as the default export
  const glue = (await import('@neslinesli93/qpdf-wasm')) as unknown as {
    default?: unknown
  }
  const create = (glue.default ?? glue) as CreateQpdf
  // this build takes no wasmBinary: it reads the URL locateFile names
  return { create, wasmLocation: qpdfWasmUrl }
}
