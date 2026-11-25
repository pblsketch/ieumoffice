// One open PDF with its pending edits: save, Save As, share, recovery copies, the
// reload after a save, and the services the feature slots call. No React here; the
// Workspace (startPdfEditDocument.tsx) and the chrome hook read it.
//
// Save follows the PC editor (spec 2.2, 3.11): nothing changed → nothing written;
// otherwise the PC save code in the engine worker writes the whole file; a verify
// failure or a refused write keeps every pending edit and leaves the file alone.
import type { Params } from '@genoffice/i18n'
import type { MobileDocSession } from '@genoffice/mobile-bridge/transport'
import { isMobileCommandError } from '@genoffice/mobile-bridge/transport'
import type { ActiveDocState } from '@genoffice/mobile-bridge/session-state'
import { imageRectKey } from '../../../../../../pdf/src/renderer/ImageEditLayer'
import type { EditSnapshot } from '../../../../../../pdf/src/renderer/edit-state'
import type { OpContext } from '../../../../../../pdf/src/renderer/edit-ops'
import type { MobileStringKey } from '../../../i18n/strings'
import type { EditorHost } from '../../editorKind'
import { getPdfEngine, type PdfEngine, type PdfSaveResult } from '../engine'
import type { PdfUnlockProbe } from '../openTypes'
import type { PdfOpenedDocument } from '../view/model'
import { openPdfModel } from '../view/openPdf'
import { sharePdfOriginal } from '../view/startPdfDocument'
import { createPdfEditStore, newEditId, type PdfEditStore } from './editStore'
import { pickPdfFile } from './pickPdfFile'
import { createRecoveryGate } from './recoveryGate'
import { assertAnnotationChoice, buildSavePdfRequest, pdfFileName } from './saveRequest'
import type {
  PdfAnnotationChoice,
  PdfEditServices,
  PdfOpContextProvider,
  PdfRequestExtras,
  PdfSignatureHandler,
} from './types'

/** Asks how a Save As copy handles annotations; null when the person cancelled. */
export type PdfAnnotationPrompt = () => Promise<PdfAnnotationChoice | null>

export interface PdfEditSessionOptions {
  readonly host: EditorHost
  readonly model: PdfOpenedDocument
  /** The session the document was opened in (App passes it to every save/share call too). */
  readonly session: MobileDocSession
  /** Used when the document is reloaded from saved bytes (an encrypted file asks it again). */
  readonly unlockProbe: PdfUnlockProbe
  /** Clock of the recovery-copy rules (tests). */
  readonly now?: () => number
  readonly engine?: () => PdfEngine
  /** The open document was replaced (after a save or `reopenFromBytes`). */
  readonly onModelReplaced?: (next: PdfOpenedDocument, previous: PdfOpenedDocument) => void
}

export interface PdfEditSession {
  readonly store: PdfEditStore
  readonly services: PdfEditServices
  getModel(): PdfOpenedDocument
  subscribeModel(listener: () => void): () => void
  getSession(): MobileDocSession
  isSaving(): boolean
  /** The mounted Workspace asks with the Save As sheet; without one a copy keeps annotations. */
  setAnnotationPrompt(prompt: PdfAnnotationPrompt | null): void
  save(doc: ActiveDocState, forceSaveAs: boolean): Promise<boolean>
  share(doc: ActiveDocState): Promise<void>
  writeRecovery(doc: ActiveDocState): Promise<void>
}

export function bytesToBase64(bytes: Uint8Array): string {
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(text)
}

const VERIFY_FAILED = /save-verify-failed pages=([\d,]+)/

export function createPdfEditSession(options: PdfEditSessionOptions): PdfEditSession {
  const { host, unlockProbe } = options
  const engine = options.engine ?? getPdfEngine
  let model = options.model
  let docSession = options.session
  let extras: PdfRequestExtras = {}
  let saving: Promise<boolean> | null = null
  let annotationPrompt: PdfAnnotationPrompt | null = null
  let signatureHandler: PdfSignatureHandler | null = null
  const contextProviders = new Set<PdfOpContextProvider>()
  const modelListeners = new Set<() => void>()
  const gate = createRecoveryGate({ now: options.now })

  /** PC App.tsx `editOpContext` over the mobile state. */
  const opContext = (s: EditSnapshot): OpContext => {
    const fieldNames = new Set<string>(s.formFields.map((f) => f.input.name))
    const radioGroups = new Set<string>(
      s.formFields.filter((f) => f.input.kind === 'radio').map((f) => f.input.name),
    )
    for (const provide of contextProviders) {
      const part = provide()
      for (const name of part.fieldNames ?? []) fieldNames.add(name)
      for (const name of part.radioGroups ?? []) radioGroups.add(name)
    }
    return {
      readOnly: model.readOnlyReason !== null,
      pageCount: model.pages.length + s.blankPages.length,
      deleted: s.deleted,
      claimedImages: new Set(
        s.imageEdits.flatMap((e) =>
          e.input.kind === 'insertImage'
            ? []
            : [`${e.input.pageIndex}:${imageRectKey(e.input.oldRect)}`],
        ),
      ),
      fieldNames,
      radioGroups,
    }
  }

  const store = createPdfEditStore({ context: opContext, newId: newEditId })
  /** Open inputs a feature has not committed yet (a text box being typed in). */
  const drafts = new Set<() => Promise<void>>()
  // a restored recovery copy is unsaved until it is written somewhere; an open draft is unsaved too
  const unsaved = () => store.hasEdits() || model.fromRecovery || drafts.size > 0
  const flushDrafts = async () => {
    for (const flush of [...drafts]) await flush().catch(() => {})
  }
  store.subscribe(() => {
    gate.bump()
    host.markDirty(unsaved())
    host.contentChanged()
  })

  const t = (key: MobileStringKey, params?: Params) => host.translate(key, params)
  const toastError = (message: string) => host.showToast({ message, tone: 'error' })

  const replaceModel = (next: PdfOpenedDocument) => {
    const previous = model
    if (previous === next) return
    model = next
    for (const listener of [...modelListeners]) listener()
    options.onModelReplaced?.(next, previous)
    // after the Workspace re-rendered with the new document
    setTimeout(() => void previous.destroy().catch(() => {}), 0)
  }

  const openFromBytes = (
    bytes: Uint8Array,
    session: MobileDocSession,
    isUntitled: boolean,
    previous: PdfOpenedDocument,
  ) =>
    openPdfModel({
      bytes,
      fileName: session.name,
      writable: session.writable,
      isUntitled,
      fromRecovery: false,
      // the same file again: the password that opened it, once
      askPassword: async ({ wrong }) => (wrong ? null : previous.password),
      unlockProbe,
    })

  const noticeSkipped = (result: PdfSaveResult) => {
    const skipped = [
      ...result.skippedTextEdits,
      ...result.skippedTextInserts,
      ...result.skippedImageEdits,
    ]
    if (skipped.length === 0) return
    const pages = [...new Set(skipped.map((s) => s.pageIndex + 1))].sort((a, b) => a - b)
    host.showToast(t('pdfEditSaveSkipped', { pages: pages.join(', ') }))
  }

  const reportSaveError = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    const verify = VERIFY_FAILED.exec(message)
    toastError(
      verify
        ? t('pdfEditSaveVerifyFailed', { pages: verify[1]!.split(',').join(', ') })
        : t('pdfEditSaveFailed'),
    )
  }

  /** Writes the bytes to the file (or a new one); the session they now live in, or null. */
  const writeBytes = async (
    doc: ActiveDocState,
    bytes: Uint8Array,
    saveAs: boolean,
  ): Promise<MobileDocSession | null> => {
    const client = host.client
    const bytesBase64 = bytesToBase64(bytes)
    if (saveAs) {
      let next: MobileDocSession
      try {
        next = await client.saveAsFileBytes({
          sessionId: doc.session.sessionId,
          suggestedName: pdfFileName(doc.session.name),
          format: 'pdf',
          bytesBase64,
        })
      } catch (err) {
        if (!(isMobileCommandError(err) && err.code === 'USER_CANCELLED')) {
          toastError(t('pdfEditSaveFailed'))
        }
        return null
      }
      await client.recoveryDiscard(doc.session.docKey).catch(() => {})
      docSession = next
      host.updateSession({ session: next, dirty: false, isUntitled: false })
      return next
    }
    try {
      await client.saveFileBytes(doc.session.sessionId, bytesBase64)
    } catch (err) {
      if (isMobileCommandError(err) && err.code === 'READ_ONLY_URI') {
        // the file cannot be written back: the same bytes go to a new file
        host.setNotice(t('readonlyShareNotice'))
        return writeBytes(doc, bytes, true)
      }
      toastError(t('pdfEditSaveFailed'))
      return null
    }
    await client.recoveryDiscard(doc.session.docKey).catch(() => {})
    host.markDirty(drafts.size > 0)
    return doc.session
  }

  /** The file now holds `bytes`: show what it holds, with no pending edits and a fresh undo history. */
  const reloadAfterWrite = async (
    bytes: Uint8Array,
    session: MobileDocSession,
    isUntitled: boolean,
  ) => {
    const previous = model
    try {
      replaceModel(await openFromBytes(bytes, session, isUntitled, previous))
    } catch {
      toastError(t('pdfEditReloadFailed'))
    }
    store.reset()
    gate.invalidate()
    host.markDirty(drafts.size > 0)
  }

  const saveOnce = async (doc: ActiveDocState, forceSaveAs: boolean): Promise<boolean> => {
    docSession = doc.session
    const current = model
    const edits = store.getSnapshot()
    const hasEdits = store.hasEdits()
    const saveAs =
      forceSaveAs || current.isUntitled || !doc.session.writable || doc.session.ephemeral
    if (!saveAs && !hasEdits) {
      // nothing changed: the file is not written (spec 3.11)
      if (!current.fromRecovery) host.markDirty(drafts.size > 0)
      return true
    }
    let annotations: PdfAnnotationChoice = 'keep'
    // PC: a protected document's copy keeps its annotations without asking
    if (forceSaveAs && !current.encrypted && annotationPrompt) {
      const picked = await annotationPrompt()
      if (picked === null) return false
      annotations = picked
    }
    assertAnnotationChoice({ inPlace: !saveAs, encrypted: current.encrypted, annotations })

    store.setLocked(true)
    try {
      let bytes: Uint8Array
      try {
        if (!hasEdits && annotations === 'keep') {
          // a clean copy is the source bytes (PC `copyOnly`)
          bytes = current.originalBytes
        } else {
          const request = buildSavePdfRequest(edits, current, extras)
          const result = await engine().saveBytes(
            current.originalBytes,
            annotations === 'keep' ? request : { ...request, annotations },
          )
          bytes = result.bytes
          noticeSkipped(result)
        }
      } catch (err) {
        reportSaveError(err)
        return false
      }
      const session = await writeBytes(doc, bytes, saveAs)
      if (!session) return false
      await reloadAfterWrite(bytes, session, false)
      host.showToast(t('savedNotice'))
      await host.refreshHome().catch(() => {})
      return true
    } finally {
      store.setLocked(false)
    }
  }

  const save = async (doc: ActiveDocState, forceSaveAs: boolean): Promise<boolean> => {
    // what is still being typed belongs to this save
    await flushDrafts()
    // one save at a time: a second one starts from what the first left
    while (saving) await saving.catch(() => false)
    const run = saveOnce(doc, forceSaveAs)
    saving = run
    try {
      return await run
    } finally {
      if (saving === run) saving = null
    }
  }

  const docState = (): ActiveDocState => ({
    session: docSession,
    dirty: store.hasEdits() || model.fromRecovery,
    encrypted: false,
    distribution: false,
    trackingDropped: false,
    isUntitled: model.isUntitled,
  })

  const services: PdfEditServices = {
    dispatch: (ops, dispatchOptions) => store.dispatch(ops, dispatchOptions),
    getEdits: () => store.getSnapshot(),
    getModel: () => model,
    getSession: () => docSession,
    saveNow: () => save(docState(), false),
    async reopenFromBytes(bytes) {
      const previous = model
      const next = await openFromBytes(bytes, docSession, previous.isUntitled, previous)
      replaceModel(next)
      store.reset()
      gate.invalidate()
      host.markDirty(drafts.size > 0)
    },
    async writeFileBytes(bytes) {
      try {
        await host.client.saveFileBytes(docSession.sessionId, bytesToBase64(bytes))
      } catch {
        toastError(t('pdfEditSaveFailed'))
        return false
      }
      await host.client.recoveryDiscard(docSession.docKey).catch(() => {})
      return true
    },
    async requestSignature(target) {
      if (signatureHandler) {
        await signatureHandler(target)
        return
      }
      host.showToast(t('pdfEditSignatureUnavailable'))
    },
    registerSignatureHandler(handler) {
      signatureHandler = handler
      return () => {
        if (signatureHandler === handler) signatureHandler = null
      }
    },
    pickPdfFile: () => pickPdfFile(),
    engine: () => engine(),
    setRequestExtras(patch) {
      extras = { ...extras, ...patch }
    },
    registerOpContext(provider) {
      contextProviders.add(provider)
      return () => contextProviders.delete(provider)
    },
    registerDraft(flush) {
      drafts.add(flush)
      host.markDirty(true)
      return () => {
        if (!drafts.delete(flush)) return
        host.markDirty(unsaved())
      }
    },
    newId: newEditId,
    showToast: (input) => host.showToast(input),
    translate: (key, params) => host.translate(key, params),
  }

  return {
    store,
    services,
    getModel: () => model,
    subscribeModel(listener) {
      modelListeners.add(listener)
      return () => modelListeners.delete(listener)
    },
    getSession: () => docSession,
    isSaving: () => saving !== null,
    setAnnotationPrompt(prompt) {
      annotationPrompt = prompt
    },
    save,

    async share(doc) {
      await flushDrafts()
      docSession = doc.session
      const current = model
      if (!store.hasEdits()) {
        await sharePdfOriginal(host.client, doc.session, current).catch(() => {})
        return
      }
      try {
        // unsaved edits are shared as the document would be saved
        const bytes = await engine().applyEdits(
          current.originalBytes,
          buildSavePdfRequest(store.getSnapshot(), current, extras),
        )
        await host.client.shareFile({
          sessionId: doc.session.sessionId,
          suggestedName: doc.session.name,
          mode: 'edited',
          bytesBase64: bytesToBase64(bytes),
        })
      } catch {
        toastError(t('pdfEditShareFailed'))
      }
    },

    async writeRecovery(doc) {
      docSession = doc.session
      const current = model
      // an encrypted document never leaves a plain or protected copy behind (spec 3.11)
      if (current.encrypted || !store.hasEdits()) return
      const flush = typeof document !== 'undefined' && document.visibilityState === 'hidden'
      if (!gate.due({ busy: saving !== null, flush })) return
      const edits = store.getSnapshot()
      await gate.run(async () => {
        const bytes = await engine().applyEdits(
          current.originalBytes,
          buildSavePdfRequest(edits, current, extras),
        )
        if (model !== current) return 'superseded'
        const outcome = await host.client.recoveryWrite({
          docKey: doc.session.docKey,
          format: 'pdf',
          title: doc.session.name,
          bytesBase64: bytesToBase64(bytes),
        })
        return outcome.ok === false ? 'failed' : 'written'
      })
    },
  }
}
