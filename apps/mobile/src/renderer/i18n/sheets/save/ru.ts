import type { zh } from './zh'

export const ru = {
  sheetsShareFailed: 'Не удалось поделиться этим файлом.',
  sheetsSaveFailed: 'Не удалось сохранить. Исходный файл не изменён.',
  sheetsSaveAsTitle: 'Сохранить как',
  sheetsShareTitle: 'Поделиться в формате',
  sheetsFormatWorkbook: 'Книга Excel (.xlsx)',
  sheetsFormatWorkbookMacro: 'Книга Excel с поддержкой макросов (.xlsm)',
  sheetsFormatCsv: 'CSV (только текущий лист)',
  sheetsFormatOds: 'Таблица ODS (копия книги)',
  sheetsFormatPdf: 'PDF (текущий лист)',
  sheetsOdsEncrypted: 'Книгу с паролем нельзя экспортировать в ODS.',
  sheetsChoiceCancel: 'Отмена',
  sheetsCsvAskTitle: 'Сохранение CSV-файла',
  sheetsCsvAskMessage: 'В CSV-файле сохраняются только значения текущего листа.',
  sheetsCsvAskCsv: 'Сохранить как CSV (без форматирования и других листов)',
  sheetsCsvAskXlsx: 'Сохранить как файл Excel',
  sheetsCsvFormulaTitle: 'Формулы сохранят только значения',
  sheetsCsvFormulaMessage:
    'Формулы этого листа сохранятся в CSV только как вычисленные значения. Чтобы сохранить формулы, сохраните файл в формате Excel.',
  sheetsCsvContinue: 'Продолжить с CSV',
  sheetsOdsLossTitle: 'Экспорт в ODS',
  sheetsOdsLossMessage:
    'Функции, которые ODS не поддерживает (формулы, диаграммы, рисунки, условное форматирование и т. п.), — {count} шт. — не попадут в копию.',
  sheetsOdsContinue: 'Продолжить',
  sheetsOdsUnreadable: 'Созданный файл ODS не удалось открыть снова, поэтому он не записан.',
  sheetsOdsFailed: 'Не удалось экспортировать в ODS.',
  sheetsCopySaved: 'Копия сохранена: {name}',
  sheetsPdfWorking: 'Создание PDF…',
  sheetsPdfFailed: 'Не удалось создать PDF.',
  sheetsPdfSkippedVisuals: 'Не удалось поместить в PDF рисунков или диаграмм: {count}.',
  sheetsPdfMissingGlyphs:
    'Символов, которых нет в шрифтах: {count}. В PDF они показаны пустыми прямоугольниками.',
  sheetsSaveErrDiskChanged:
    'После открытия оригинал изменило другое приложение. Он не перезаписан; используйте «Сохранить как».',
  sheetsSaveErrTooLarge:
    'Файл слишком большой (больше примерно 14 МБ) для записи на этом телефоне. Оригинал не изменён.',
  sheetsSaveErrUnreadable:
    'Сохранённую книгу не удалось открыть снова, поэтому оригинал оставлен без изменений.',
  sheetsSaveErrLockFailed:
    'Не удалось снова защитить книгу её паролем, поэтому оригинал оставлен без изменений.',
  sheetsSaveBusy: 'Идёт сохранение. Повторите попытку, когда оно закончится.',
} as const satisfies Record<keyof typeof zh, string>
