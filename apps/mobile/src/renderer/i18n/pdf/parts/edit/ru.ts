import type { zh } from './zh'

export const ru = {
  pdfEditPen: 'Перо',
  pdfEditHighlighter: 'Маркер',
  pdfEditTextBox: 'Текстовое поле',
  pdfEditSign: 'Подписать',
  pdfEditPages: 'Упорядочить страницы',
  pdfEditLink: 'Вставить ссылку',
  pdfEditSaveFailed: 'Не удалось сохранить. Ваши изменения остались, файл не изменён.',
  pdfEditSaveSkipped: 'Не удалось сохранить некоторые правки текста на странице {pages}.',
  pdfEditShareFailed: 'Не удалось поделиться.',
  pdfEditReloadFailed: 'Сохранено, но документ не удалось загрузить заново. Откройте файл ещё раз.',
  pdfEditSignatureUnavailable: 'Подпись пока недоступна.',
  pdfEditSaveAsHint:
    'Выберите, как обрабатывать выделения, заметки и рисунки в копии. «Впечатать в страницы» впечатывает и поля формы; «Не включать аннотации» сохраняет ссылки и поля формы.',
  pdfEditKeepAnnots: 'Оставить аннотации (можно редактировать в других приложениях)',
  pdfEditFlattenAnnots: 'Впечатать в страницы (видно во всех приложениях)',
  pdfEditStripAnnots: 'Не включать аннотации (ссылки и поля остаются)',
  pdfEditSaveVerifyFailed:
    'Изменения на странице {pages} не удалось записать полностью; сохранение отменено, файл не изменён. Отмените затронутую правку и попробуйте снова',
} as const satisfies Record<keyof typeof zh, string>
