// Global declarations of track T4 html and markdown (e.g. a reference to a desktop editor's env.d.ts it reuses:
// /// <reference path="..." />). Owned by that track; this folder is already in the type check.
//
// The HTML AI reuses the desktop HTML editor's tools (editors/html/htmlAi.ts). Some of their code
// names the desktop's main-process window API, so its type is declared here. There is no value:
// the phone has no `window.htmlApi`, and the tools that use it are not offered there.
import type { HtmlApi } from '../../../html/src/shared/ipc'

declare global {
  interface Window {
    htmlApi: HtmlApi
  }
}

export {}
