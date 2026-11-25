import type { zh } from './zh'

export const ru = {
  pdfLinkPlaceHint: 'Проведите рамку на странице там, где будет ссылка',
  pdfLinkEditTitle: 'Изменить ссылку',
  pdfLinkUrlLabel: 'Веб-адрес (http, https, mailto)',
  pdfLinkPageLabel: 'Или страница в этом документе (1–{count})',
  pdfLinkUrlInvalid: 'Можно ссылаться только на адреса http, https и mailto',
  pdfLinkPageInvalid: 'Введите номер страницы от 1 до {count}',
  pdfLinkNeedTarget: 'Введите веб-адрес или номер страницы',
  pdfLinkApply: 'Добавить ссылку',
  pdfLinkDelete: 'Удалить ссылку',
  pdfLinkPending: 'Ссылка к добавлению: {target}',
  pdfLinkToPage: 'Страница {page}',
  pdfLinkFailed: 'Не удалось изменить ссылку. Повторите попытку после сохранения.',
  pdfLinkUpdate: 'Применить',
} as const satisfies Record<keyof typeof zh, string>
