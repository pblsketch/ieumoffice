// Opening a PDF for the mobile editor, following the PC open pipeline
// (apps/pdf/src/renderer/App.tsx `loadDoc`/`openPath`): password loop, the app's own
// handler for the lock, page probing, and the in-memory blank-page patch for lost pages.
import './pdfjs'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { loadPdfForView } from '../../../../../../pdf/src/renderer/open-document'
import {
  probePageGeometry,
  type PageProbeResult,
} from '../../../../../../pdf/src/renderer/page-probe'
import { createSearchIndexCache } from '../../../../../../pdf/src/renderer/search'
import { DOC_OPTS } from '../../../../../../pdf/src/renderer/view-config'
import {
  PdfOpenCancelledError,
  PdfOpenError,
  type PdfPasswordPrompt,
  type PdfUnlockProbe,
} from '../openTypes'
import type { PdfOpenedDocument } from './model'
import { getDocument } from './pdfjs'
import { pdfReadOnlyReason, type PdfLock } from './readOnly'

export interface PdfOpenInput {
  readonly bytes: Uint8Array
  readonly fileName: string
  readonly writable: boolean
  readonly isUntitled: boolean
  readonly fromRecovery: boolean
  readonly askPassword: PdfPasswordPrompt
  readonly unlockProbe: PdfUnlockProbe
}

function isPasswordException(err: unknown): boolean {
  return (err as { name?: unknown } | null)?.name === 'PasswordException'
}

/** Opens `bytes` with PDF.js, asking for the password as often as it is wrong. */
async function openWithPassword(
  input: PdfOpenInput,
): Promise<{ proxy: PDFDocumentProxy; password: string | undefined }> {
  let password: string | undefined
  let certificateChecked = false
  for (;;) {
    const task = loadPdfForView(input.bytes, password)
    try {
      return { proxy: await task.promise, password }
    } catch (err) {
      // a failed open leaves the rejected task holding the bytes and its worker
      void task.destroy()
      if (!isPasswordException(err)) throw new PdfOpenError('unreadable', { cause: err })
      if (!certificateChecked) {
        certificateChecked = true
        // a certificate-encrypted file has no password to type: say so instead of looping
        const probe = await input.unlockProbe(input.bytes, '').catch(() => null)
        if (probe && !probe.ok && probe.reason === 'certificate-encryption') {
          throw new PdfOpenError('certificate', { cause: err })
        }
      }
      const answer = await input.askPassword({
        fileName: input.fileName,
        wrong: password !== undefined,
      })
      if (answer === null) throw new PdfOpenCancelledError()
      password = answer
    }
  }
}

export async function openPdfModel(input: PdfOpenInput): Promise<PdfOpenedDocument> {
  const opened = await openWithPassword(input)
  let proxy = opened.proxy
  const password = opened.password
  try {
    const metadata = await proxy.getMetadata()
    // PC form-catalog `documentFormFeatures`: PDF.js names the filter of an encrypted file
    const encrypted =
      (metadata.info as { EncryptFilterName?: string | null }).EncryptFilterName != null
    let sessionUnlocked = false
    let lock: PdfLock | null = null
    if (encrypted) {
      // PDF.js accepted this password for showing; our own handler must accept it too
      // before the document counts as editable, and it says which password it was
      const outcome = await input.unlockProbe(input.bytes, password ?? '').catch(() => null)
      if (outcome?.ok) {
        sessionUnlocked = true
        lock = { unlockedAsOwner: outcome.unlockedAs === 'owner', modifying: outcome.modifying }
      }
    }

    let probe: PageProbeResult = await probePageGeometry(proxy)
    let damaged = false
    if (probe.failures.length > 0) {
      // A lost page object takes every page PDF.js walks past it down with it: show the
      // lost one blank from patched bytes in memory, read-only (the file is untouched).
      const { patchMissingPageKids } =
        await import('../../../../../../pdf/src/renderer/page-tree-patch')
      const patched = await patchMissingPageKids(input.bytes)
      if (patched) {
        const retry = getDocument({ data: patched.bytes, password, ...DOC_OPTS })
        const reopened = await retry.promise.catch(() => {
          void retry.destroy()
          return null
        })
        if (reopened) {
          void proxy.loadingTask.destroy()
          proxy = reopened
          probe = await probePageGeometry(proxy)
          damaged = true
        }
      }
    }

    const readOnlyReason = pdfReadOnlyReason({
      damaged,
      encrypted,
      sessionUnlocked,
      lock,
      writable: input.writable,
      isUntitled: input.isUntitled,
    })
    const finalProxy = proxy
    return {
      proxy: finalProxy,
      originalBytes: input.bytes,
      password: password ?? null,
      encrypted,
      sessionUnlocked,
      lock,
      damaged,
      failedPages: new Set(probe.failures.map((f) => f.page)),
      pages: probe.pages,
      readOnlyReason,
      isUntitled: input.isUntitled,
      fromRecovery: input.fromRecovery,
      searchIndex: createSearchIndexCache(),
      destroy: () => finalProxy.loadingTask.destroy(),
    }
  } catch (err) {
    // pdfjs-dist 6 has no PDFDocumentProxy.destroy(): go through the loading task
    void proxy.loadingTask.destroy()
    if (err instanceof PdfOpenError) throw err
    throw new PdfOpenError('unreadable', { cause: err })
  }
}
