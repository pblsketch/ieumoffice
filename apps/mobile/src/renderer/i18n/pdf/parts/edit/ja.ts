import type { zh } from './zh'

export const ja = {
  pdfEditPen: 'ペン',
  pdfEditHighlighter: '蛍光ペン',
  pdfEditTextBox: 'テキストボックス',
  pdfEditSign: '署名',
  pdfEditPages: 'ページの整理',
  pdfEditLink: 'リンクを挿入',
  pdfEditSaveFailed: '保存できませんでした。変更は残っており、ファイルは変更されていません。',
  pdfEditSaveSkipped: 'ページ {pages} の一部の文字の編集を保存できませんでした。',
  pdfEditShareFailed: '共有できませんでした。',
  pdfEditReloadFailed:
    '保存しましたが、文書を再読み込みできませんでした。ファイルを開き直してください。',
  pdfEditSignatureUnavailable: '署名はまだ使えません。',
  pdfEditSaveAsHint:
    'コピー内のハイライト・メモ・描画の扱いを選びます。「ページに焼き込む」はフォーム欄も焼き込み、「注釈を含めない」はリンクとフォーム欄を残します。',
  pdfEditKeepAnnots: '注釈を残す（他のアプリで編集可能）',
  pdfEditFlattenAnnots: 'ページに焼き込む（どのアプリでも表示）',
  pdfEditStripAnnots: '注釈を含めない（リンクとフォーム欄は残す）',
  pdfEditSaveVerifyFailed:
    'ページ {pages} の変更を完全に書き込めなかったため、保存を中止しました（ファイルは変更されていません）。該当の編集を取り消してからもう一度お試しください',
} as const satisfies Record<keyof typeof zh, string>
