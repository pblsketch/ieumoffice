import type { zh } from './zh'

export const ja = {
  sheetsProvisionalNotice: '試用版のグリッドです。変更はまだ保存されません。',
  sheetsLoading: 'グリッドを読み込んでいます…',
  sheetsShareFailed: 'このファイルを共有できませんでした。',
  sheetsFreezeTopRow: '先頭行を固定',
  sheetsFreezeFirstColumn: '先頭列を固定',
  sheetsUnfreeze: 'ウィンドウ枠の固定を解除',
  sheetsKeyboardBar: '数式入力ツール',
  sheetsInsertSum: '合計関数',
  sheetsInsertParens: 'かっこ',
  sheetsNumericKeys: '数字キーボード',
  sheetsCancelEdit: 'キャンセル',
  sheetsConfirmEdit: '確定',
} as const satisfies Record<keyof typeof zh, string>
