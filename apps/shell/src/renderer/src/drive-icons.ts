import type { DriveEntryType } from '../../shared/drive-api'
import iconDocx from './assets/file-docx.svg'
import iconXlsx from './assets/file-xlsx.svg'
import iconPptx from './assets/file-pptx.svg'
import iconPdf from './assets/file-pdf.svg'
import iconMd from './assets/file-md.svg'
import iconHtml from './assets/file-html.svg'
import iconMindmap from './assets/file-mindmap.svg'
import iconHwp from './assets/file-hwp.svg'
import iconEpub from './assets/file-epub.svg'
import iconDiagram from './assets/file-diagram.svg'
import iconWhiteboard from './assets/file-whiteboard.svg'

export const DRIVE_ENTRY_ICONS: Partial<Record<DriveEntryType, string>> = {
  document: iconDocx,
  spreadsheet: iconXlsx,
  presentation: iconPptx,
  pdf: iconPdf,
  markdown: iconMd,
  html: iconHtml,
  mindmap: iconMindmap,
  hwp: iconHwp,
  epub: iconEpub,
  diagram: iconDiagram,
  whiteboard: iconWhiteboard,
}
