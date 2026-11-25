import type { zh } from './zh'

export const zhTW = {
  pdfLinkPlaceHint: '在頁面上拖出放置連結的區域',
  pdfLinkEditTitle: '編輯連結',
  pdfLinkUrlLabel: '網址（http、https、mailto）',
  pdfLinkPageLabel: '或本文件中的頁（1–{count}）',
  pdfLinkUrlInvalid: '只能連結 http、https 或 mailto 位址',
  pdfLinkPageInvalid: '請輸入 1 到 {count} 之間的頁碼',
  pdfLinkNeedTarget: '請輸入網址或頁碼',
  pdfLinkApply: '新增連結',
  pdfLinkDelete: '刪除連結',
  pdfLinkPending: '待新增的連結：{target}',
  pdfLinkToPage: '第 {page} 頁',
  pdfLinkFailed: '無法變更連結。請在儲存完成後再試一次。',
  pdfLinkUpdate: '變更',
} as const satisfies Record<keyof typeof zh, string>
