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
import type { PdfEditDocumentOptions } from './edit'

/** Replaceable parts of the open path (tests, and PDF-T4 wiring the engine worker). */
export interface PdfKindDeps {
  /** Default: the password sheet over the app. */
  readonly askPassword?: (lang: Lang) => PdfPasswordPrompt
  /** Default: the PC security handler (apps/pdf/src/main/pdf-crypt.ts). */
  readonly unlockProbe?: PdfUnlockProbe
  /** Default: the PC blank PDF (apps/pdf/src/main/blank-pdf.ts). */
  readonly blankPdf?: () => Promise<Uint8Array>
  /** Replaces the edit frame with the bare viewer and these options (view-only tests). */
  readonly documentOptions?: PdfDocumentOptions
  /** Options of the edit frame (tests: feature slots, the recovery clock). */
  readonly edit?: Pick<PdfEditDocumentOptions, 'features' | 'now' | 'engine'>
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
      const lang = await appLang(client)
      const [view, edit] = await Promise.all([import('./view'), import('./edit')])
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
      const reason = model.readOnlyReason
      /** The document to free on close: a save reloads it into a new one. */
      let current: PdfOpenedDocument = model
      const release = () => void current.destroy().catch(() => {})
      return {
        // "protected, must not be changed": only a PDF whose permissions keep it read-only.
        // A damaged or unwritable PDF is read-only through `editable: false` below.
        encrypted: reason === 'encrypted',
        noticeKey: model.failedPages.size > 0 && !model.damaged ? 'pdfViewPagesFailed' : null,
        // the switch did not go through: this PDF was never shown
        discard: release,
        start: (host) => {
          const doc = deps.documentOptions
            ? view.startPdfDocument(host, model, deps.documentOptions)
            : edit.startPdfEditDocument(host, model, {
                ...deps.edit,
                session,
                unlockProbe: deps.unlockProbe ?? view.pcUnlockProbe,
                onModelReplaced: (next) => {
                  current = next
                },
              })
          // read on every App render: a Save As of an unwritable PDF reloads a writable copy
          Object.defineProperty(doc, 'editable', {
            get: () => current.readOnlyReason === null,
            enumerable: true,
          })
          return Object.assign(doc, {
            // closed or replaced: free the PDF.js document and the engine worker (PDFium)
            dispose: () => {
              release()
              void import('./engine').then((engine) => engine.disposePdfEngine())
            },
          })
        },
      }
    },
  }
}

export const pdfEditorKind: EditorKind = createPdfEditorKind()
