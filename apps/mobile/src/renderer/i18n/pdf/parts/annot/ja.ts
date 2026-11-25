import type { zh } from './zh'

export const ja = {
  pdfAnnotHighlight: 'ハイライト',
  pdfAnnotUnderline: '下線',
  pdfAnnotSquiggly: '波線',
  pdfAnnotStrikeout: '取り消し線',
  pdfAnnotModeSelect: 'テキストを選択',
  pdfAnnotModeNote: 'メモを置く',
  pdfAnnotHintSelect:
    'テキストの上を横にドラッグするか、長押ししてからドラッグして選択します。マークアップをタップすると色の変更や削除ができます。',
  pdfAnnotHintNote: 'メモを置く場所をタップしてください。',
  pdfAnnotPen: '蛍光ペン {n}',
  pdfAnnotColor: '色 {n}',
  pdfAnnotRemove: 'マークアップを削除',
  pdfAnnotMarkupTitle: 'マークアップの色',
  pdfAnnotClearSelection: '選択を解除',
  pdfAnnotNoText: 'このページには選択できるテキストがありません。',
  pdfAnnotOpenNote: 'メモを開く',
  pdfAnnotFailed: '注釈を変更できませんでした。',
  pdfAnnotNewNote: '新しいメモ',
  pdfAnnotReplyPlaceholder: '返信を入力',
} as const satisfies Record<keyof typeof zh, string>
