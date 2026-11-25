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
  homeRunStep: 'Шаг {current} из {total}',
  homeRunWelcomeTitle: 'Добро пожаловать',
  homeRunWelcomeBody:
    'Открывайте и редактируйте HWP, PDF, Markdown и другие документы в GenOffice. Без учётной записи и рекламы, а документы остаются на этом устройстве.',
  homeRunNext: 'Далее',
  homeRunSkip: 'Пропустить',
  homeRunFolderTitle: 'Подключить папку с документами (необязательно)',
  homeRunFolderBody:
    'Подключите папку, которой часто пользуетесь, и её файлы сразу появятся на вкладке [Папки].',
  homeRunFolderPick: 'Выбрать папку',
  homeRunLater: 'Позже',
  homeRunFolderLinked: '✓ Папка с документами подключена · Изменить можно в настройках',
  homeRunStart: 'Начать',
  homeRunTipEditButton: 'Чтобы внести изменения, нажмите [Изменить]',
  homeRunTipFlowView: 'Включён поточный вид для удобного чтения · Постраничный вид здесь',
  homeRunTipFirstEdit:
    'Копия для восстановления создаётся автоматически. Оригинал сохраняется, когда вы нажимаете [Готово]',
  homeRunTipFirstKeyboard: 'Меняйте оформление текста кнопкой [Aa]',
} as const satisfies Record<keyof typeof zh, string>
