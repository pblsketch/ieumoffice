// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../../../../../../../packages/pdf2docx/src/bidi-js.d.ts" />
// The PC save code's request types (apps/pdf/src/shared/ipc.ts) reach pdf2docx
// through type-only imports; the reference above brings its bidi-js typings.

// Vite `?url` imports of the PDF engine's lazily fetched assets
declare module '*.wasm?url' {
  const url: string
  export default url
}

declare module '*.woff2?url' {
  const url: string
  export default url
}
