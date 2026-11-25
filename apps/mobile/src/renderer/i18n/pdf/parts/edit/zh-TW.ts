import type { zh } from './zh'

export const zhTW = {
  pdfEditPen: '筆',
  pdfEditHighlighter: '螢光筆',
  pdfEditTextBox: '文字方塊',
  pdfEditSign: '簽名',
  pdfEditPages: '整理頁面',
  pdfEditLink: '插入連結',
  pdfEditSaveFailed: '無法儲存。修改仍然保留，原檔未被變更。',
  pdfEditSaveSkipped: '第 {pages} 頁的部分文字修改未能儲存。',
  pdfEditShareFailed: '無法分享。',
  pdfEditReloadFailed: '已儲存，但無法重新載入文件。請重新開啟檔案。',
  pdfEditSignatureUnavailable: '簽名功能尚未提供。',
  pdfEditSaveAsHint:
    '選擇副本中的螢光標記、備註和繪圖如何處理。「嵌入頁面」也會嵌入表單欄位；「不包含註解」會保留連結和表單欄位。',
  pdfEditKeepAnnots: '保留註解（可在其他應用程式編輯）',
  pdfEditFlattenAnnots: '嵌入頁面（所有應用程式都看得到）',
  pdfEditStripAnnots: '不包含註解（保留連結和表單欄位）',
  pdfEditSaveVerifyFailed:
    '第 {pages} 頁的修改未能完整寫回，已取消儲存以保護原檔；請復原該頁的相關修改後重試',
} as const satisfies Record<keyof typeof zh, string>
