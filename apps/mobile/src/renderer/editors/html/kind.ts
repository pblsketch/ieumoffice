import { normalizeLang } from '@genoffice/i18n'
import type { EditorKind } from '../editorKind'

/** The language of a new document: the app's screen language, as on the desktop. */
function screenLang() {
  return normalizeLang(typeof document === 'undefined' ? null : document.documentElement.lang)
}

/**
 * HTML documents (spec 5.1). The document module (element map with parse5, preview copy,
 * workspace) and the file bridge are a chunk loaded only when an HTML document opens.
 */
export const htmlEditorKind: EditorKind = {
  id: 'html',
  formats: ['html'],
  openExtensions: ['html', 'htm'],
  // a new document starts from the desktop editor's standards-mode skeleton (owner, 11-26 Q7)
  createFormats: ['html'],
  labelKey: 'webHtmlEditorLabel',
  editable: true,
  hasAi: true,
  recoveryFormat: () => 'html',
  async open({ session, client, isUntitled, recoveryBytesBase64 }) {
    const [{ base64ToBytes, createMobileHtmlApi }, { prepareHtmlSource, startHtmlDocument }] =
      await Promise.all([import('@genoffice/mobile-bridge/html'), import('./htmlDocument')])
    const htmlApi = createMobileHtmlApi(client)
    let text: string
    let readOnly = false
    if (recoveryBytesBase64) {
      // a recovery copy's own bytes decide its envelope (BOM, line ends), like a file's do
      const opened = htmlApi.openFromBytes(session, base64ToBytes(recoveryBytesBase64))
      text = opened.text
      readOnly = opened.utf8 === false
    } else if (isUntitled) {
      const { documentSkeleton } =
        await import('../../../../../html/src/renderer/document/skeleton')
      text = documentSkeleton(screenLang())
    } else {
      const opened = await htmlApi.readDocument(session)
      text = opened.text
      // not UTF-8: edited text would be saved garbled, so this document is view and share only
      readOnly = opened.utf8 === false
    }
    const prepared = prepareHtmlSource({ text, readOnly })
    return {
      noticeKey: prepared.noticeKey,
      start: (host) => startHtmlDocument(host, htmlApi, prepared),
    }
  },
}
