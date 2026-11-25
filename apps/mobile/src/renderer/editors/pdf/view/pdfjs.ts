// PDF.js for the mobile PDF editor: the legacy build (as the PC editor uses) with its
// worker served from the app bundle. The CMaps, standard fonts and wasm decoders sit at
// `pdfjs/` next to the page (vite.config.ts copies them), the path PC view-config.ts reads.
import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

// Under Node (the test runner) PDF.js has already chosen its in-process worker; keep it.
if (!GlobalWorkerOptions.workerSrc) GlobalWorkerOptions.workerSrc = workerUrl

export { AnnotationMode, TextLayer, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
