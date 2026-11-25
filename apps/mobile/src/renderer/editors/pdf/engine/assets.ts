/**
 * Lazy loading of the engine's heavy assets into the virtual file table. The
 * PC code reads them synchronously by path, so each is loaded before the
 * request that needs it runs: PDFium (~4.6 MB) only for requests that use it,
 * harfbuzz and the fonts only for text work.
 */
import type { BundledFontAsset } from './fontTable'
import { VIRTUAL_MODULE_FILES } from './node-shims/module'
import { vfsIsFile, vfsPut } from './node-shims/vfs'

export type EngineAsset = 'pdfium.wasm' | 'hb-subset.wasm' | BundledFontAsset

export type EngineAssetLoader = (asset: EngineAsset) => Promise<Uint8Array>

async function fetchAsset(asset: EngineAsset): Promise<Uint8Array> {
  const { ENGINE_ASSET_URLS } = await import('./assetUrls')
  const url = new URL(ENGINE_ASSET_URLS[asset], globalThis.location?.href)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`pdf engine asset ${asset}: HTTP ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

let loader: EngineAssetLoader = fetchAsset

/** Replace how assets are fetched (tests read them from disk); null restores fetch */
export function setEngineAssetLoader(next: EngineAssetLoader | null): void {
  loader = next ?? fetchAsset
}

export function loadEngineAsset(asset: EngineAsset): Promise<Uint8Array> {
  return loader(asset)
}

/**
 * Run `task` once; concurrent callers share it, and a failure is forgotten so
 * the next call retries (a dropped connection must not disable the engine).
 */
export function once(task: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | null = null
  return () => {
    running ??= task().catch((error: unknown) => {
      running = null
      throw error
    })
    return running
  }
}

type WasmAsset = 'pdfium.wasm' | 'hb-subset.wasm'

const WASM_PATHS: Readonly<Record<WasmAsset, string>> = {
  'pdfium.wasm': VIRTUAL_MODULE_FILES['@embedpdf/pdfium/pdfium.wasm']!,
  'hb-subset.wasm': VIRTUAL_MODULE_FILES['harfbuzzjs/hb-subset.wasm']!,
}

const wasmLoaders = new Map<WasmAsset, () => Promise<void>>()

/** Put a wasm file where the PC code's wasm-path.ts looks for it */
export function ensureWasm(asset: WasmAsset): Promise<void> {
  let load = wasmLoaders.get(asset)
  if (!load) {
    load = once(async () => {
      const path = WASM_PATHS[asset]
      if (!vfsIsFile(path)) vfsPut(path, await loadEngineAsset(asset))
    })
    wasmLoaders.set(asset, load)
  }
  return load()
}
