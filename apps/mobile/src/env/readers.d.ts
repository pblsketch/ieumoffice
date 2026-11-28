// Global declarations of track T5 readers (epub, pptx). Owned by that track; this folder is already in the type check.
// The slides renderer reuses pptx-render, whose text layout imports the untyped `bidi-js`; its module
// declaration is an ambient file, which only a reference brings in (an import would make it a module).
// pdf2docx's declaration is used because it is a superset of pptx-render's (which only needs
// getEmbeddingLevels) and track T2 references the same file: one `declare module 'bidi-js'` for the app.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../../../../packages/pdf2docx/src/bidi-js.d.ts" />
