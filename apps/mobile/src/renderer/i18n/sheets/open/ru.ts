import type { zh } from './zh'

export const ru = {
  sheetsEditorName: 'Excel',
  sheetsLoading: 'Загрузка таблицы…',
  sheetsOpening: 'Открытие книги… Большие файлы открываются дольше.',
  sheetsPasswordTitle: 'Книга, защищённая паролем',
  sheetsPasswordMessage: 'Введите пароль, чтобы открыть эту книгу.',
  sheetsPasswordLabel: 'Пароль',
  sheetsPasswordWrong: 'Неверный пароль. Попробуйте ещё раз.',
  sheetsPasswordOpen: 'Открыть',
  sheetsPasswordCancel: 'Отмена',
  sheetsEncryptionUnsupported: 'Этот способ защиты паролем не поддерживается.',
  sheetsEncryptionDamaged: 'Защищённая книга повреждена и не может быть открыта.',
  sheetsNoticeMacros: 'Макросы сохраняются, но не запускаются.',
  sheetsNoticeExternalLinks:
    'Ячейки со ссылками на другие файлы показывают последние сохранённые значения.',
  sheetsNoticeMacrosAndLinks:
    'Макросы сохраняются, но не запускаются. Ячейки со ссылками на другие файлы показывают последние сохранённые значения.',
} as const satisfies Record<keyof typeof zh, string>
