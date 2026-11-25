/**
 * Engine worker entry: runs `pdfEngineCore` operations off the page thread so
 * PDFium and pdf-lib never block the screen. Results' byte arrays are moved
 * (transferred) back, not copied.
 */
import { handleEngineRequest } from './dispatch'
import type { PdfEngineRequest, PdfEngineResponse } from './protocol'
import { transferablesOf } from './protocol'

interface WorkerScope {
  onmessage: ((event: MessageEvent<PdfEngineRequest>) => void) | null
  postMessage(message: PdfEngineResponse, transfer: Transferable[]): void
}

const scope = globalThis as unknown as WorkerScope

scope.onmessage = (event) => {
  void handleEngineRequest(event.data).then((response) => {
    scope.postMessage(response, response.ok ? transferablesOf(response.result) : [])
  })
}
