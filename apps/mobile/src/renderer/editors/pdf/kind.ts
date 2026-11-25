// The PDF editor kind. This file stays light: PDF.js and the viewer load on the
// first PDF open (dynamic import), so the app's start size does not grow.
import { normalizeLang, type Lang } from '@genoffice/i18n'
import type { MobileClient, MobileDocFormat } from '@genoffice/mobile-bridge/transport'
import { translateMobile, type MobileStringKey } from '../../i18n/strings'
import type { EditorKind, EditorOpened } from '../editorKind'
import {
  PdfOpenError,
  type PdfOpenErrorKind,
  type PdfPasswordPrompt,
  type PdfUnlockProbe,
} from './openTypes'
import type { PdfDocumentOptions, PdfOpenedDocument } from './view'

/** Replaceable parts of the open path (tests, and PDF-T4 wiring the engine worker). */
export interface PdfKindDeps {
  /** Default: the password sheet over the app. */
  readonly askPassword?: (lang: Lang) => PdfPasswordPrompt
  /** Default: the PC security handler (apps/pdf/src/main/pdf-crypt.ts). */
  readonly unlockProbe?: PdfUnlockProbe
  /** Default: the PC blank PDF (apps/pdf/src/main/blank-pdf.ts). */
  readonly blankPdf?: () => Promise<Uint8Array>
  /** Edit mode and features on top of the viewer (PDF-T4). */
  readonly documentOptions?: PdfDocumentOptions
}

const OPEN_ERROR_KEYS: Record<PdfOpenErrorKind, MobileStringKey> = {
  unreadable: 'pdfViewOpenFailed',
  certificate: 'pdfViewCertEncrypted',
  'blank-unavailable': 'pdfViewBlankUnavailable',
}

export function base64ToBytes(b64: string): Uint8Array {
  const text = atob(b64)
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i)
  return out
}

async function appLang(client: MobileClient): Promise<Lang> {
  try {
    return normalizeLang((await client.getAppPrefs()).lang)
  } catch {
    return 'en'
  }
}

type Releasable = Pick<PdfOpenedDocument, 'destroy'>

/**
 * One document is open at a time (app rule). App has no "closed" call, so the
 * PDF.js document of the previous PDF is released when the next one starts, and a
 * PDF whose switch was refused (never started) when the next open begins.
 */
const lifecycle = {
  active: null as Releasable | null,
  unstarted: null as Releasable | null,
}

export function createPdfEditorKind(deps: PdfKindDeps = {}): EditorKind {
  return {
    id: 'pdf',
    formats: ['pdf'],
    openExtensions: ['pdf'],
    createFormats: ['pdf'],
    labelKey: 'pdfViewEditorName',
    editable: true,
    hasAi: true,
    recoveryFormat: (_format: MobileDocFormat) => 'pdf',
    async open({ session, client, isUntitled, recoveryBytesBase64 }): Promise<EditorOpened> {
      if (lifecycle.unstarted) {
        void lifecycle.unstarted.destroy().catch(() => {})
        lifecycle.unstarted = null
      }
      const lang = await appLang(client)
      const view = await import('./view')
      let model: PdfOpenedDocument
      try {
        const bytes = recoveryBytesBase64
          ? base64ToBytes(recoveryBytesBase64)
          : isUntitled
            ? await (deps.blankPdf ?? view.pcBlankPdfBytes)()
            : base64ToBytes((await client.readFileBytes(session.sessionId)).bytesBase64)
        model = await view.openPdfModel({
          bytes,
          fileName: session.name,
          writable: session.writable,
          isUntitled,
          fromRecovery: recoveryBytesBase64 !== undefined,
          askPassword: (deps.askPassword ?? view.createSheetPasswordPrompt)(lang),
          unlockProbe: deps.unlockProbe ?? view.pcUnlockProbe,
        })
      } catch (err) {
        if (err instanceof PdfOpenError) {
          throw new Error(translateMobile(lang, OPEN_ERROR_KEYS[err.kind]), { cause: err })
        }
        throw err
      }
      lifecycle.unstarted = model
      const reason = model.readOnlyReason
      return {
        // App treats this flag as "protected": no edit mode, no AI edits, no recovery copy
        encrypted: reason === 'encrypted' || reason === 'damaged',
        noticeKey: model.failedPages.size > 0 && !model.damaged ? 'pdfViewPagesFailed' : null,
        start: (host) => {
          if (lifecycle.unstarted === model) lifecycle.unstarted = null
          if (lifecycle.active && lifecycle.active !== model) {
            void lifecycle.active.destroy().catch(() => {})
          }
          lifecycle.active = model
          return view.startPdfDocument(host, model, deps.documentOptions)
        },
      }
    },
  }
}

export const pdfEditorKind: EditorKind = createPdfEditorKind()
