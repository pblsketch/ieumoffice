import type { zh } from './zh'

export const ar = {
  sheetsToolbarFormat: 'تنسيق الخلية',
  sheetsToolbarRows: 'الصفوف والأعمدة',
  sheetsToolbarSort: 'الفرز والتصفية',
  sheetsToolbarInsert: 'إدراج',
  sheetsToolbarInsertValues: 'التواريخ والأوراق',
  sheetsToolbarToday: 'تاريخ اليوم',
  sheetsToolbarTimeNow: 'الوقت الحالي',
  sheetsToolbarNewSheet: 'ورقة جديدة',
  sheetsToolbarFind: 'بحث',
  sheetsToolbarViewOnly:
    'المخططات والجداول المحورية والتنسيق الشرطي للعرض فقط هنا. افتح الملف على حاسوب لتغييرها.',
  sheetsToolbarFullLoaded: 'تم تحميل المصنف بالكامل. اضغط على الفرز أو التصفية مرة أخرى.',
} as const satisfies Record<keyof typeof zh, string>
