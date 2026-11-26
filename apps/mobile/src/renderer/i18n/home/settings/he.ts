import type { zh } from './zh'

export const he = {
  homeSetEditorsTitle: 'עורכים',
  homeSetEditorsHint:
    'עורכים כבויים לא מופיעים ברשימת המסמכים החדשים. כיבוי של כולם נחשב כהפעלה של כולם.',
  homeSetEditorHwp: 'HWP',
  homeSetEditorMarkdown: 'Markdown',
  homeSetEditorPdfTools: 'כלי PDF',
  homeSetCardsTitle: 'מסמכים חדשים במסך הבית',
  homeSetCardShow: 'הצגת {name} במסך הבית',
  homeSetCardUp: 'הזזת {name} למעלה',
  homeSetCardDown: 'הזזת {name} למטה',
  homeSetKeepScreenOn: 'המסך נשאר דולק בזמן קריאה',
  homeSetKeepScreenOnDesc: 'המסך לא כבה בזמן קריאה של PDF או EPUB או הצגה של PPT.',
  homeSetFoldersTitle: 'תיקיות מסמכים',
  homeSetFoldersEmpty:
    'עדיין לא קושרו תיקיות. קשרו תיקייה כדי לראות את הקבצים שלה ישר בכרטיסייה תיקיות.',
  homeSetFolderLink: 'קישור תיקייה',
  homeSetFolderRelink: 'קישור מחדש',
  homeSetFolderRemove: 'הסרה',
  homeSetFolderRemoveNamed: 'הסרת {name}',
  homeSetFolderOk: 'מקושרת',
  homeSetFolderLost: 'אין גישה לתיקייה הזו. אם העברתם או מחקתם אותה, קשרו אותה מחדש.',
  homeSetFolderRemoveTitle: 'להסיר את התיקייה "{name}"?',
  homeSetFolderRemoveBody:
    'גם {count} הרשומות באחרונים ובמועדפים של קבצים בתיקייה הזו יוסרו. הקבצים עצמם נשארים.',
  homeSetBackupsTotal: 'סך הכול {size}',
  homeSetStorageTitle: 'אחסון',
  homeSetStorageRecovery: 'עותקי שחזור',
  homeSetStorageTemp: 'קבצים זמניים',
  homeSetStorageBackups: 'גיבויי מקור HWP',
  homeSetStorageClearTemp: 'מחיקת קבצים זמניים',
  homeSetStorageClearRecovery: 'מחיקת כל עותקי השחזור',
  homeSetStorageClearTempTitle: 'למחוק את הקבצים הזמניים?',
  homeSetStorageClearTempBody:
    'יימחקו קבצים שנוצרו לזמן קצר בזמן שיתוף או קבלה. המסמכים שלכם לא ישתנו.',
  homeSetStorageClearRecoveryTitle: 'למחוק את כל עותקי השחזור?',
  homeSetStorageClearRecoveryBody:
    'שינויים שלא נשמרו יאבדו. עותק השחזור של המסמך הפתוח עכשיו יישמר.',
  homeSetStorageClearAction: 'מחיקה',
  homeSetStorageCleared: 'התפנו {size}.',
  homeSetFailed: 'הפעולה לא הצליחה. נסו שוב בעוד רגע.',
} as const satisfies Record<keyof typeof zh, string>
