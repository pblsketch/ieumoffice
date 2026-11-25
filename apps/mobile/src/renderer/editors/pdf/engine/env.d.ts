// The bidi-js typings the PC request types need come from src/env/pdf.d.ts.

// Vite `?url` imports of the PDF engine's lazily fetched assets
declare module '*.wasm?url' {
  const url: string
  export default url
}

declare module '*.woff2?url' {
  const url: string
  export default url
}
