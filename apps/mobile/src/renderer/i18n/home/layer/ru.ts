import type { zh } from './zh'

export const ru = {
  homeRunEditorOffTitle: 'Редактор «{name}» выключен',
  homeRunEditorOffBody:
    'Включите его, чтобы открыть этот файл. Выключить снова можно в настройках.',
  homeRunEditorOffConfirm: 'Включить и открыть',
  homeRunStripSample: 'Пример документа · Только чтение',
  homeRunStripReceived: 'Полученный файл · Только чтение',
  homeRunStripReadOnly: 'Только чтение',
  homeRunStripCopy: 'Изменить копию',
  homeRunStripClose: 'Закрыть уведомление',
  homeRunReceiveTitle: 'Полученные файлы',
  homeRunReceiveCount: 'Файлов: {count}',
  homeRunReceiveClose: 'Закрыть полученные файлы',
  homeRunReceiveOpen: 'Открыть',
  homeRunReceivePdfOff: 'Инструменты PDF выключены',
  homeRunReceivePdfOn: 'Включить и продолжить',
  homeRunGuideLabel: 'Знакомство с приложением',
  homeRunWelcomeTitle: 'Добро пожаловать',
  homeRunWelcomeBody:
    'Открывайте и редактируйте HWP, PDF, Markdown и другие документы в GenOffice. Без учётной записи и рекламы, а документы остаются на этом устройстве.',
  homeRunStart: 'Начать',
  homeRunTipEditButton: 'Чтобы внести изменения, нажмите [Изменить]',
  homeRunTipFlowView: 'Чтобы читать по ширине экрана, нажмите [Режим чтения]',
  homeRunTipFirstEdit:
    'Копия для восстановления создаётся автоматически. Оригинал сохраняется, когда вы нажимаете [Готово]',
  homeRunTipFirstKeyboard: 'Меняйте оформление текста кнопкой [Aa]',
} as const satisfies Record<keyof typeof zh, string>
