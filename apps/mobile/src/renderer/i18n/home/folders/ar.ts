import type { zh } from './zh'

export const ar = {
  homeFolderListLabel: 'المجلدات المرتبطة',
  homeFolderEmptyTitle: 'لا توجد مجلدات مرتبطة بعد',
  homeFolderEmptyBody: 'اربط مجلدًا تستخدمه كثيرًا لتظهر مستنداته وصوره هنا مباشرة.',
  homeFolderLink: 'إضافة مجلد',
  homeFolderRelink: 'إعادة الربط',
  homeFolderRelinkNamed: 'إعادة ربط {name}',
  homeFolderOk: 'مرتبط',
  homeFolderLostRevoked: 'فُقد إذن الوصول إلى هذا المجلد. اربطه مرة أخرى.',
  homeFolderLostMissing: 'تعذّر العثور على هذا المجلد. إذا نقلته أو حذفته، فاربطه مرة أخرى.',
  homeFolderLost: 'تعذّر الوصول إلى المجلد. اربطه مرة أخرى.',
  homeFolderMenu: 'قائمة {name}',
  homeFolderRemove: 'إزالة',
  homeFolderRemoveTitle: 'هل تريد إزالة المجلد "{name}"؟',
  homeFolderRemoveBody:
    'ستُزال أيضًا إدخالات الأخيرة والمفضلة لملفات هذا المجلد وعددها {count}. لن تُحذف الملفات نفسها.',
  homeFolderRemoved: 'أُزيل المجلد.',
  homeFolderBack: 'المجلد الأعلى',
  homeFolderPath: 'المجلد الحالي',
  homeFolderSubfolder: 'مجلد',
  homeFolderInsideEmpty: 'لا توجد في هذا المجلد مستندات أو صور يمكن فتحها.',
} as const satisfies Record<keyof typeof zh, string>
