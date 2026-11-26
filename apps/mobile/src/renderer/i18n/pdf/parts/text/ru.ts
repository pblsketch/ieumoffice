import type { zh } from './zh'

export const ru = {
  pdfTextHint:
    'Коснитесь пустого места, чтобы добавить текст, или коснитесь текста, чтобы изменить его.',
  pdfTextInputLabel: 'Добавляемый текст',
  pdfTextEditLabel: 'Изменяемый текст',
  pdfTextStyleBar: 'Стиль текста',
  pdfTextBold: 'Жирный',
  pdfTextSize: 'Размер текста',
  pdfTextSizeDown: 'Уменьшить текст',
  pdfTextSizeUp: 'Увеличить текст',
  pdfTextColor: 'Цвет текста',
  pdfTextColorDocument: 'Оставить цвет документа',
  pdfTextFont: 'Шрифт',
  pdfTextFontDocument: 'Шрифт документа',
  pdfTextBack: 'Назад',
  pdfTextDelete: 'Удалить',
  pdfTextDone: 'Готово',
  pdfTextCannotDraw: 'Эти символы нельзя добавить: {chars}',
  pdfTextFontSubstituted: 'Эти символы будут показаны другим шрифтом: {chars}',
  pdfTextScannedPage: 'На этой странице нет текста. Можно только добавить новый текст.',
  pdfTextNoMatch: 'Этот текст нельзя изменить: он не найден в документе.',
  pdfTextOverflow: 'Изменённый текст наложится на текст ниже. Сократите его.',
} as const satisfies Record<keyof typeof zh, string>
