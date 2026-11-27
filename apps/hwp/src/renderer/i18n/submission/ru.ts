import type { zh } from './zh'

export const ru = {
  staleDialogTitle: 'Требуется обновление элементов',
  staleDialogBody:
    'После последних правок следующие элементы могли устареть. Обновить их перед продолжением?',
  staleActionSave: 'Сохранить',
  staleActionPrint: 'Печать',
  staleActionPdf: 'Экспорт в PDF',
  staleActionSubmission: 'Сохранить копию для подачи',
  staleBtnRefreshAll: 'Обновить все',
  staleBtnContinue: 'Продолжить без обновления',
  staleBtnCancel: 'Отмена',
  staleReasonPagesChanged: 'Изменились номера страниц',
  staleReasonEntriesChanged: 'Изменились записи',
  staleKindTocBody: 'Оглавление',
  staleKindTocTable: 'Список таблиц',
  staleKindTocFigure: 'Список рисунков',
  staleKindTocEquation: 'Список формул',
  staleKindIndex: 'Указатель',
  staleKindBibliography: 'Список литературы',
  staleManualConfirmTitle: 'Обнаружены ручные правки',
  staleManualConfirmBody: 'Обнаружены ручные изменения в: {items}. Перезаписать их и обновить?',
  staleManualOverwrite: 'Перезаписать и обновить',
  staleManualSkip: 'Пропустить',
  staleRefreshDone: 'Обновлено элементов: {count}.',
  staleRefreshFailed: 'Не удалось обновить некоторые элементы: {error}',
  staleRefreshBlockedObjects:
    'Обновление пропущено, так как в области оглавления или указателя есть пользовательские объекты: сноски, изображения или таблицы.',
  submissionMenuLabel: 'Сохранить копию для подачи…',
  submissionMenuDesc:
    'Сохраняет отдельную чистую копию без меток указателя, цитирования и настроек.',
  submissionSaving: 'Создание копии для подачи…',
  submissionSaved: 'Копия для подачи сохранена: {name}',
  submissionBackupKept: 'Сохранена резервная копия прежнего файла: {name}',
  submissionSavedTailsLost:
    'Копия для подачи сохранена ({name}). Некоторые мастер-страницы или примечания могли не сохраниться.',
  submissionFailedProtected: 'Защищённые паролем документы нельзя сохранить как копию для подачи.',
  submissionFailedTracked: 'Документы с режимом исправлений нельзя сохранить как копию для подачи.',
  submissionFailedSameAsOpen:
    'Нельзя перезаписать открытый документ копией для подачи. Выберите другое имя файла.',
  submissionFailedStrip:
    'Копия для подачи не сохранена, так как не удалось удалить некоторые внутренние метки: {marks}',
  submissionFailedVerify:
    'Проверка копии для подачи не удалась ({before} → {after} стр.). Попробуйте формат HWPX.',
  submissionFailedExport: 'Не удалось создать копию для подачи: {error}',
  submissionFailedWrite: 'Не удалось сохранить копию для подачи: {error}',
} satisfies Record<keyof typeof zh, string>
