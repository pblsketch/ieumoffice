/**
 * Stand-in for `node:module` inside the PC PDF save code on the phone.
 * wasm-path.ts asks createRequire().resolve for its wasm files; the answer is
 * the virtual path engine/assets.ts loads those bytes to.
 */
import { notOnMobile } from './unsupported'

export const VIRTUAL_MODULE_FILES: Readonly<Record<string, string>> = {
  '@embedpdf/pdfium/pdfium.wasm': '/ieum-mobile/wasm/pdfium.wasm',
  'harfbuzzjs/hb-subset.wasm': '/ieum-mobile/wasm/hb-subset.wasm',
}

function notFound(id: string): Error {
  return Object.assign(new Error(`Cannot find module '${id}'`), { code: 'MODULE_NOT_FOUND' })
}

export function createRequire(_from: unknown) {
  const require = (id: string): never => notOnMobile(`require(${id})`)
  require.resolve = (id: string): string => {
    const path = VIRTUAL_MODULE_FILES[id]
    if (!path) throw notFound(id)
    return path
  }
  return require
}

export const builtinModules: string[] = []

export default { createRequire, builtinModules }
