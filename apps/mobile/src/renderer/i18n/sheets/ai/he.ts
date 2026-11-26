import type { zh } from './zh'

export const he = {
  sheetsAiUndoRefused: 'הגיליון נערך אחרי השינויים של הבינה המלאכותית, ולכן הם לא בוטלו.',
  sheetsAiUndoPartial: 'לא ניתן היה לבטל חלק מהשינויים של הבינה המלאכותית. בדקו את הגיליון.',
  sheetsAiUndoExpired:
    'כבר אי אפשר לבטל את השינויים של הבינה המלאכותית בצעד אחד (החוברת נשמרה או נערכה הרבה מאז). השתמשו בביטול.',
} as const satisfies Record<keyof typeof zh, string>
