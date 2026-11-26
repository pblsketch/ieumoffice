import type { zh } from './zh'

export const ar = {
  sheetsAiUndoRefused: 'تم تعديل الورقة بعد تغييرات الذكاء الاصطناعي، لذلك لم يتم التراجع عنها.',
  sheetsAiUndoPartial: 'تعذر التراجع عن بعض تغييرات الذكاء الاصطناعي. يرجى التحقق من الورقة.',
  sheetsAiUndoExpired:
    'لم يعد بالإمكان التراجع عن تغييرات الذكاء الاصطناعي دفعة واحدة (تم حفظ المصنف أو تعديله كثيرًا بعدها). استخدم التراجع.',
} as const satisfies Record<keyof typeof zh, string>
