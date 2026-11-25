import type { zh } from './zh'

export const ar = {
  pdfAnnotHighlight: 'تمييز',
  pdfAnnotUnderline: 'تسطير',
  pdfAnnotSquiggly: 'خط متموج',
  pdfAnnotStrikeout: 'يتوسطه خط',
  pdfAnnotModeSelect: 'تحديد النص',
  pdfAnnotModeNote: 'وضع ملاحظة',
  pdfAnnotHintSelect:
    'اسحب أفقيًا فوق النص، أو اضغط مطولًا ثم اسحب، للتحديد. اضغط على علامة لتغيير لونها أو إزالتها.',
  pdfAnnotHintNote: 'اضغط على المكان الذي تريد وضع الملاحظة فيه.',
  pdfAnnotPen: 'قلم التمييز {n}',
  pdfAnnotColor: 'اللون {n}',
  pdfAnnotRemove: 'إزالة العلامة',
  pdfAnnotMarkupTitle: 'لون العلامة',
  pdfAnnotClearSelection: 'إلغاء التحديد',
  pdfAnnotNoText: 'لا يوجد نص قابل للتحديد في هذه الصفحة.',
  pdfAnnotOpenNote: 'فتح الملاحظة',
  pdfAnnotFailed: 'تعذّر تغيير التعليق التوضيحي.',
  pdfAnnotNewNote: 'ملاحظة جديدة',
  pdfAnnotReplyPlaceholder: 'اكتب ردًا',
} as const satisfies Record<keyof typeof zh, string>
