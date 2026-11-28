import { app, net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'
import {
  DOCX_MEDIA_SCHEME_PRIVILEGE,
  SLIDE_MEDIA_SCHEME_PRIVILEGE,
  RENDERER_SCHEME,
  RENDERER_SCHEME_PRIVILEGE,
  resolveRendererFile,
} from './renderer-scheme'
import { uiFontResponse } from './ui-font-response'
import { uiFontsDir } from './ui-fonts-dir'

/** Before app ready; a process may call registerSchemesAsPrivileged only once,
 * so hosts that register other schemes spread RENDERER_SCHEME_PRIVILEGE into
 * their own list instead. */
export function registerRendererScheme(): void {
  protocol.registerSchemesAsPrivileged([
    RENDERER_SCHEME_PRIVILEGE,
    DOCX_MEDIA_SCHEME_PRIVILEGE,
    SLIDE_MEDIA_SCHEME_PRIVILEGE,
  ])
}

/** After app ready: serve each module's built renderer directory and the
 * shared UI font folder (`genoffice-app://ui-fonts/<file>`). */
export function installRendererProtocol(roots: Record<string, string>): void {
  const table = new Map(Object.entries(roots))
  const fontsDir = uiFontsDir({
    isPackaged: app.isPackaged,
    getAppPath: () => app.getAppPath(),
    resourcesPath: process.resourcesPath ?? '',
  })
  protocol.handle(RENDERER_SCHEME, async (request) => {
    const font = await uiFontResponse(request.url, fontsDir)
    if (font) return font
    const file = resolveRendererFile(table, request.url)
    if (!file) return new Response(null, { status: 404 })
    return net
      .fetch(pathToFileURL(file).toString())
      .catch(() => new Response(null, { status: 404 }))
  })
}
