import type { zh } from './zh'

export const en = {
  sheetsToolbarFormat: 'Cell format',
  sheetsToolbarRows: 'Rows & columns',
  sheetsToolbarSort: 'Sort & filter',
  sheetsToolbarInsert: 'Insert',
  sheetsToolbarInsertValues: 'Dates and sheets',
  sheetsToolbarToday: "Today's date",
  sheetsToolbarTimeNow: 'Current time',
  sheetsToolbarNewSheet: 'New sheet',
  sheetsToolbarFind: 'Find',
  sheetsToolbarViewOnly:
    'Charts, pivot tables and conditional formatting are view-only here. Open the file on a computer to change them.',
  sheetsToolbarFullLoaded: 'The whole workbook is loaded. Tap sort or filter again.',
} as const satisfies Record<keyof typeof zh, string>
