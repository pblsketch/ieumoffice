import type { zh } from './zh'

export const ru = {
  pdfAnnotHighlight: 'Выделение',
  pdfAnnotUnderline: 'Подчеркнуть',
  pdfAnnotSquiggly: 'Волнистая линия',
  pdfAnnotStrikeout: 'Зачеркнуть',
  pdfAnnotModeSelect: 'Выделить текст',
  pdfAnnotModeNote: 'Поставить заметку',
  pdfAnnotHintSelect:
    'Чтобы выделить, проведите по тексту в сторону или нажмите и удерживайте, а затем потяните. Коснитесь пометки, чтобы изменить цвет или удалить её.',
  pdfAnnotHintNote: 'Коснитесь места для заметки.',
  pdfAnnotPen: 'Маркер {n}',
  pdfAnnotColor: 'Цвет {n}',
  pdfAnnotRemove: 'Удалить пометку',
  pdfAnnotMarkupTitle: 'Цвет пометки',
  pdfAnnotClearSelection: 'Снять выделение',
  pdfAnnotNoText: 'На этой странице нет текста, который можно выделить.',
  pdfAnnotOpenNote: 'Открыть заметку',
  pdfAnnotFailed: 'Не удалось изменить аннотацию.',
  pdfAnnotNewNote: 'Новая заметка',
  pdfAnnotReplyPlaceholder: 'Напишите ответ',
} as const satisfies Record<keyof typeof zh, string>
