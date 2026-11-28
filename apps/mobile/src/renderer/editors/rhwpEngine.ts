import init, { HwpDocument } from '@rhwp/core'
import type { FlowSourceDocument } from './hwpFlow'

/** Path of the studio's rhwp WASM, filled in at build time (see vite.config.ts). */
declare const __IEUM_RHWP_WASM__: string

const FLOW_HOST_PATH = './studio/flow-host.html'

interface FlowHostExports {
  readonly HwpDocument: new (bytes: Uint8Array) => FlowEngineDocument
  readonly Uint8Array: Uint8ArrayConstructor
}

interface FlowHostWindow extends Window {
  __ieumInitRhwp?: ((wasmUrl: string) => Promise<FlowHostExports>) | null
}

interface FlowHost {
  readonly iframe: HTMLIFrameElement
  readonly exports: FlowHostExports
}

let engineReady: Promise<void> | null = null
let flowHost: FlowHost | null = null
let flowHostPromise: Promise<FlowHost> | null = null
let hostGeneration = 0

function canUseDisposableIframeHost(): boolean {
  if (typeof document === 'undefined' || typeof window === 'undefined') return false
  if (typeof __IEUM_RHWP_WASM__ !== 'string' || __IEUM_RHWP_WASM__.length === 0) return false
  // Vitest/jsdom does not execute module scripts inside iframes.
  const meta = import.meta as unknown as { env?: { VITEST?: unknown } }
  if (meta.env?.VITEST) return false
  return true
}

function teardownIframe(iframe: HTMLIFrameElement): void {
  try {
    const win = iframe.contentWindow as FlowHostWindow | null
    if (win) win.__ieumInitRhwp = null
  } catch {
    // Ignore cross-origin or already-detached iframe errors.
  }
  try {
    iframe.src = 'about:blank'
  } catch {
    // Ignore navigation errors during detach.
  }
  iframe.remove()
}

function createFlowHost(gen: number): Promise<FlowHost> {
  return new Promise<FlowHost>((resolve, reject) => {
    const iframe = document.createElement('iframe')
    iframe.style.display = 'none'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    iframe.setAttribute('aria-hidden', 'true')
    iframe.tabIndex = -1
    iframe.dataset.ieumRhwpHost = 'true'
    const hostUrl = new URL(FLOW_HOST_PATH, window.location.href).href
    const wasmUrl = new URL(__IEUM_RHWP_WASM__, window.location.href).href

    let settled = false
    const fail = (err: unknown) => {
      if (settled) return
      settled = true
      teardownIframe(iframe)
      reject(err instanceof Error ? err : new Error(String(err)))
    }

    const startInit = () => {
      if (settled) return
      if (gen !== hostGeneration) {
        fail(new Error('rhwp flow host released before ready'))
        return
      }
      const win = iframe.contentWindow as FlowHostWindow | null
      const initFn = win?.__ieumInitRhwp
      if (!initFn) return
      settled = true
      void initFn(wasmUrl)
        .then((exports) => {
          if (gen !== hostGeneration) {
            teardownIframe(iframe)
            reject(new Error('rhwp flow host released during init'))
            return
          }
          const created: FlowHost = { iframe, exports }
          flowHost = created
          resolve(created)
        })
        .catch((err) => {
          teardownIframe(iframe)
          reject(err instanceof Error ? err : new Error(String(err)))
        })
    }

    iframe.addEventListener(
      'load',
      () => {
        const win = iframe.contentWindow as FlowHostWindow | null
        if (!win) {
          fail(new Error('rhwp flow host has no contentWindow'))
          return
        }
        if (win.__ieumInitRhwp) {
          startInit()
        } else {
          win.addEventListener('ieum-rhwp-host-ready', startInit, { once: true })
        }
      },
      { once: true },
    )
    iframe.addEventListener('error', () => fail(new Error('rhwp flow host failed to load')), {
      once: true,
    })

    iframe.src = hostUrl
    document.body.appendChild(iframe)
  })
}

async function ensureFlowHost(): Promise<FlowHost> {
  if (flowHost) return flowHost
  if (!flowHostPromise) {
    const gen = hostGeneration
    flowHostPromise = createFlowHost(gen).catch((err) => {
      if (gen === hostGeneration) flowHostPromise = null
      throw err
    })
  }
  return flowHostPromise
}

/** Starts the rhwp engine once in the main window (used by Markdown-to-HWPX conversion). */
export function loadRhwpEngine(): Promise<void> {
  if (!engineReady) {
    engineReady = init({ module_or_path: __IEUM_RHWP_WASM__ }).then(() => undefined)
    engineReady.catch(() => {
      engineReady = null
    })
  }
  return engineReady
}

/**
 * Tears down the disposable same-origin iframe that hosts the flow-view rhwp WASM instance
 * so WebKit/Blink can reclaim WASM linear memory and JIT code once HWP reading ends.
 */
export function releaseRhwpEngine(): void {
  hostGeneration += 1
  flowHostPromise = null
  const current = flowHost
  flowHost = null
  if (current) teardownIframe(current.iframe)
  if (typeof document !== 'undefined') {
    for (const stale of document.querySelectorAll('iframe[data-ieum-rhwp-host="true"]')) {
      teardownIframe(stale as HTMLIFrameElement)
    }
  }
}

export interface FlowEngineDocument extends FlowSourceDocument {
  free(): void
}

/**
 * Opens document bytes for the flow view inside a disposable WASM iframe host when available,
 * falling back to the main-window module in test environments.
 */
export async function openFlowDocument(bytes: Uint8Array): Promise<FlowEngineDocument> {
  if (canUseDisposableIframeHost()) {
    const host = await ensureFlowHost()
    const copy = new host.exports.Uint8Array(bytes)
    return new host.exports.HwpDocument(copy)
  }
  await loadRhwpEngine()
  return new HwpDocument(bytes) as unknown as FlowEngineDocument
}
