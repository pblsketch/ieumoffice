import type { zh } from './zh'

export const ja = {
  sheetsShareFailed: 'このファイルを共有できませんでした。',
  sheetsSaveFailed: '保存できませんでした。元のファイルは変更されていません。',
  sheetsSaveAsTitle: '名前を付けて保存',
  sheetsShareTitle: '共有する形式',
  sheetsFormatWorkbook: 'Excel ブック (.xlsx)',
  sheetsFormatWorkbookMacro: 'Excel マクロ有効ブック (.xlsm)',
  sheetsFormatCsv: 'CSV（現在のシートのみ）',
  sheetsFormatOds: 'ODS スプレッドシート（ブックのコピー）',
  sheetsFormatPdf: 'PDF（現在のシート）',
  sheetsOdsEncrypted: 'パスワード付きのブックは ODS にエクスポートできません。',
  sheetsChoiceCancel: 'キャンセル',
  sheetsCsvAskTitle: 'CSV ファイルを保存',
  sheetsCsvAskMessage: 'CSV には現在のシートの値だけが保存されます。',
  sheetsCsvAskCsv: 'CSV で保存（書式とほかのシートは含まれません）',
  sheetsCsvAskXlsx: 'Excel ファイルとして保存',
  sheetsCsvFormulaTitle: '数式は値だけが残ります',
  sheetsCsvFormulaMessage:
    'このシートの数式は CSV では計算結果だけが残ります。数式を残すには Excel ファイルとして保存してください。',
  sheetsCsvContinue: 'CSV で続ける',
  sheetsOdsLossTitle: 'ODS にエクスポート',
  sheetsOdsLossMessage:
    'ODS に入らない {count} 個の機能（数式、グラフ、画像、条件付き書式など）はコピーに含まれません。',
  sheetsOdsContinue: '続ける',
  sheetsOdsUnreadable: '作成した ODS ファイルを開き直せなかったため、書き込みませんでした。',
  sheetsOdsFailed: 'ODS にエクスポートできませんでした。',
  sheetsCopySaved: 'コピーを保存しました: {name}',
  sheetsPdfWorking: 'PDF を作成しています…',
  sheetsPdfFailed: 'PDF を作成できませんでした。',
  sheetsPdfSkippedVisuals: '画像・グラフ {count} 個を PDF に入れられませんでした。',
  sheetsPdfMissingGlyphs: 'フォントにない {count} 文字は PDF で空の四角になります。',
  sheetsSaveErrDiskChanged:
    '開いた後にほかのアプリが元のファイルを変更しました。上書きしていないので、名前を付けて保存してください。',
  sheetsSaveErrTooLarge:
    'ファイルが大きすぎて（約 14MB 超）、このスマートフォンでは書き込めません。元のファイルはそのままです。',
  sheetsSaveErrUnreadable: '保存結果を開き直せなかったため、元のファイルはそのままにしました。',
  sheetsSaveErrLockFailed:
    '同じパスワードで再び暗号化できなかったため、元のファイルはそのままにしました。',
  sheetsSaveBusy: '保存中です。終わってからもう一度お試しください。',
} as const satisfies Record<keyof typeof zh, string>
