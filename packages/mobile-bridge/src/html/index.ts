/**
 * Owned by mobile v1 track T4 (html/markdown).
 *
 * Holds the HTML editor Tauri command wrappers, built on
 * `invokeMobileCommand` from `../transport` with `client.transport`, so the track does not
 * widen `MobileClient`, and the text envelope (BOM, line ends) the HTML and Markdown
 * editors share. The root `src/index.ts` does not re-export this module.
 */
export {
  WEB_EXPORT_MIME,
  saveNewFile,
  type SaveNewFileParams,
  type SaveNewFileResult,
  type WebExportMime,
} from './save-new-file'
export {
  IDENTITY_TEXT_ENVELOPE,
  parseTextEnvelope,
  serializeTextEnvelope,
  type ParsedTextEnvelope,
  type TextEnvelope,
} from './text-envelope'
