import type { zh } from './zh'

export const ja = {
  pdfLinkPlaceHint: 'リンクを置く範囲をページ上でドラッグしてください',
  pdfLinkEditTitle: 'リンクを編集',
  pdfLinkUrlLabel: 'ウェブアドレス（http、https、mailto）',
  pdfLinkPageLabel: 'または本文書内のページ（1–{count}）',
  pdfLinkUrlInvalid: 'リンクできるのは http、https、mailto のアドレスだけです',
  pdfLinkPageInvalid: '1 から {count} までのページ番号を入力してください',
  pdfLinkNeedTarget: 'ウェブアドレスかページ番号を入力してください',
  pdfLinkApply: 'リンクを追加',
  pdfLinkDelete: 'リンクを削除',
  pdfLinkPending: '追加予定のリンク：{target}',
  pdfLinkToPage: '{page} ページ',
  pdfLinkFailed: 'リンクを変更できませんでした。保存が終わってからもう一度お試しください。',
  pdfLinkUpdate: '変更',
} as const satisfies Record<keyof typeof zh, string>
