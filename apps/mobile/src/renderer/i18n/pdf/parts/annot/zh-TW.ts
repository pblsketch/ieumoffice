import type { zh } from './zh'

export const zhTW = {
  pdfAnnotHighlight: '螢光標示',
  pdfAnnotUnderline: '底線',
  pdfAnnotSquiggly: '波浪線',
  pdfAnnotStrikeout: '刪除線',
  pdfAnnotModeSelect: '選取文字',
  pdfAnnotModeNote: '放置便箋',
  pdfAnnotHintSelect: '在文字上橫向拖曳，或長按後拖曳來選取。點按標註可變更顏色或刪除。',
  pdfAnnotHintNote: '點按要放置便箋的位置。',
  pdfAnnotPen: '螢光筆 {n}',
  pdfAnnotColor: '顏色 {n}',
  pdfAnnotRemove: '刪除標註',
  pdfAnnotMarkupTitle: '標註顏色',
  pdfAnnotClearSelection: '取消選取',
  pdfAnnotNoText: '此頁沒有可選取的文字。',
  pdfAnnotOpenNote: '開啟便箋',
  pdfAnnotFailed: '無法變更註解。',
  pdfAnnotNewNote: '新便箋',
  pdfAnnotReplyPlaceholder: '回覆內容',
} as const satisfies Record<keyof typeof zh, string>
