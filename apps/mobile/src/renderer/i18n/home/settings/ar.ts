import type { zh } from './zh'

export const ar = {
  homeSetEditorsTitle: 'المحررات',
  homeSetEditorsHint:
    'المحررات المتوقفة لا تظهر في قائمة المستندات الجديدة. إيقافها كلها يُعدّ تشغيلًا لها كلها.',
  homeSetEditorHwp: 'HWP',
  homeSetEditorMarkdown: 'Markdown',
  homeSetEditorPdfTools: 'أدوات PDF',
  homeSetCardsTitle: 'المستندات الجديدة على الشاشة الرئيسية',
  homeSetCardShow: 'إظهار {name} على الشاشة الرئيسية',
  homeSetCardUp: 'نقل {name} لأعلى',
  homeSetCardDown: 'نقل {name} لأسفل',
  homeSetKeepScreenOn: 'إبقاء الشاشة مضاءة أثناء القراءة',
  homeSetKeepScreenOnDesc: 'لا تنطفئ الشاشة أثناء قراءة ملف PDF أو EPUB أو عرض ملف PPT.',
  homeSetFoldersTitle: 'مجلدات المستندات',
  homeSetFoldersEmpty:
    'لا توجد مجلدات مرتبطة بعد. اربط مجلدًا لترى ملفاته مباشرة في تبويب المجلدات.',
  homeSetFolderLink: 'ربط مجلد',
  homeSetFolderRelink: 'إعادة الربط',
  homeSetFolderRemove: 'إزالة',
  homeSetFolderRemoveNamed: 'إزالة {name}',
  homeSetFolderOk: 'مرتبط',
  homeSetFolderLost: 'تعذّر الوصول إلى هذا المجلد. إذا نقلته أو حذفته، فاربطه مرة أخرى.',
  homeSetFolderRemoveTitle: 'هل تريد إزالة المجلد "{name}"؟',
  homeSetFolderRemoveBody:
    'ستُزال أيضًا إدخالات الأخيرة والمفضلة لملفات هذا المجلد وعددها {count}. لن تُحذف الملفات نفسها.',
  homeSetBackupsTotal: 'الإجمالي {size}',
  homeSetStorageTitle: 'مساحة التخزين',
  homeSetStorageRecovery: 'نسخ الاسترداد',
  homeSetStorageTemp: 'الملفات المؤقتة',
  homeSetStorageBackups: 'النسخ الاحتياطية الأصلية لـ HWP',
  homeSetStorageClearTemp: 'مسح الملفات المؤقتة',
  homeSetStorageClearRecovery: 'مسح كل نسخ الاسترداد',
  homeSetStorageClearTempTitle: 'هل تريد مسح الملفات المؤقتة؟',
  homeSetStorageClearTempBody:
    'سيتم حذف الملفات التي أُنشئت مؤقتًا أثناء المشاركة أو الاستلام. تبقى مستنداتك كما هي.',
  homeSetStorageClearRecoveryTitle: 'هل تريد مسح كل نسخ الاسترداد؟',
  homeSetStorageClearRecoveryBody:
    'ستضيع التعديلات غير المحفوظة. تبقى نسخة الاسترداد للمستند المفتوح الآن.',
  homeSetStorageClearAction: 'مسح',
  homeSetStorageCleared: 'تم تحرير {size}.',
  homeSetFailed: 'تعذّر إتمام ذلك. حاول مرة أخرى بعد قليل.',
} as const satisfies Record<keyof typeof zh, string>
