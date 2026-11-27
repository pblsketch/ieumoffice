import type { zh } from './zh'

export const he = {
  staleDialogTitle: 'יש פריטים שדורשים עדכון',
  staleDialogBody:
    'הפריטים הבאים עשויים להיות לא מעודכנים לאחר השינויים האחרונים. האם לרענן לפני ההמשך?',
  staleActionSave: 'שמירה',
  staleActionPrint: 'הדפסה',
  staleActionPdf: 'ייצוא PDF',
  staleActionSubmission: 'שמירת עותק להגשה',
  staleBtnRefreshAll: 'רענון הכול',
  staleBtnContinue: 'המשך בכל זאת',
  staleBtnCancel: 'ביטול',
  staleReasonPagesChanged: 'מספרי העמודים השתנו',
  staleReasonEntriesChanged: 'הרשומות השתנו',
  staleKindTocBody: 'תוכן עניינים',
  staleKindTocTable: 'רשימת טבלאות',
  staleKindTocFigure: 'רשימת איורים',
  staleKindTocEquation: 'רשימת משוואות',
  staleKindIndex: 'אינדקס',
  staleKindBibliography: 'ביבליוגרפיה',
  staleManualConfirmTitle: 'זוהו עריכות ידניות',
  staleManualConfirmBody:
    'נמצאו עריכות ידניות ב: {items}. לדרוס אותן ולרענן בכל זאת?',
  staleManualOverwrite: 'דריסה ורענון',
  staleManualSkip: 'דילוג',
  staleRefreshDone: 'עודכנו {count} פריטים.',
  staleRefreshFailed: 'לא ניתן לעדכן חלק מהפריטים: {error}',
  submissionMenuLabel: 'שמירה כעותק להגשה…',
  submissionMenuDesc:
    'שומר עותק נקי ונפרד ללא סימוני אינדקס, ציטוטים או הגדרות.',
  submissionSaving: 'יוצר עותק להגשה…',
  submissionSaved: 'עותק להגשה נשמר: {name}',
  submissionSavedTailsLost:
    'עותק להגשה נשמר ({name}). ייתכן שחלק מעמודי האב או ההערות לא נשמרו.',
  submissionFailedProtected: 'לא ניתן לשמור מסמכים מוגנים בסיסמה כעותק להגשה.',
  submissionFailedTracked: 'לא ניתן לשמור מסמכים עם עקוב אחר שינויים כעותק להגשה.',
  submissionFailedVerify:
    'אימות עותק ההגשה נכשל ({before} → {after} עמודים). נסו לשמור בפורמט HWPX.',
  submissionFailedExport: 'לא ניתן ליצור עותק להגשה: {error}',
  submissionFailedWrite: 'לא ניתן לשמור עותק להגשה: {error}',
} satisfies Record<keyof typeof zh, string>
