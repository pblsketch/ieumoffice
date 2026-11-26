// Global declarations of track T5 readers (epub, pptx). Owned by that track; this folder is already in the type check.
// The slides renderer reuses pptx-render, whose text layout imports the untyped `bidi-js`; its module
// declaration is an ambient file, which only a reference brings in (an import would make it a module).
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../../../../packages/pptx-render/src/bidi-js.d.ts" />
