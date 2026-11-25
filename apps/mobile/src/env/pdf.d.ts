// Global declarations of track T2 pdf. Owned by that track; this folder is already in the type check.
// The mobile PDF editor reuses PC PDF modules: their shared types reach pdf2docx (bidi-js typings),
// and some renderer modules name `window.pdfApi`, which nothing provides on the phone.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../../../../packages/pdf2docx/src/bidi-js.d.ts" />
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../../../pdf/src/renderer/env.d.ts" />
