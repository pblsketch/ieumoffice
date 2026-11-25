import type { zh } from './zh'

export const ja = {
  pdfTextHint: '空いている所をタップすると文字を追加、文字をタップすると編集します。',
  pdfTextInputLabel: '追加する文字',
  pdfTextEditLabel: '編集する文字',
  pdfTextStyleBar: '文字の書式',
  pdfTextBold: '太字',
  pdfTextSize: '文字サイズ',
  pdfTextSizeDown: '文字を小さく',
  pdfTextSizeUp: '文字を大きく',
  pdfTextColor: '文字の色',
  pdfTextColorDocument: '文書の色のまま',
  pdfTextFont: 'フォント',
  pdfTextFontDocument: '文書のフォント',
  pdfTextBack: '戻る',
  pdfTextDelete: '削除',
  pdfTextDone: '確定',
  pdfTextCannotDraw: '次の文字は追加できません：{chars}',
  pdfTextFontSubstituted: '次の文字は別のフォントに変わります：{chars}',
  pdfTextScannedPage: 'このページには文字がありません。新しい文字の追加のみできます。',
  pdfTextNoMatch: 'この文字は編集できません。文書内で見つかりませんでした。',
  pdfTextOverflow: '編集した文字が下の文字と重なります。文字を短くしてください。',
} as const satisfies Record<keyof typeof zh, string>
