// Global declarations of track T3 pdf tools. Owned by that track; this folder is already in the type check.

// The PDF tools engine worker reads PDFium's and qpdf's wasm from the app bundle (tools/engine/assets.ts).
declare module '*/pdfium.wasm?url' {
  const url: string
  export default url
}

declare module '*/qpdf.wasm?url' {
  const url: string
  export default url
}
