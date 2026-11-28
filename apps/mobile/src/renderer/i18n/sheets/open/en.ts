import type { zh } from './zh'

export const en = {
  sheetsEditorName: 'Excel',
  sheetsLoading: 'Loading the grid…',
  sheetsOpening: 'Opening the workbook… Large files take a moment.',
  sheetsPasswordTitle: 'Password-protected workbook',
  sheetsPasswordMessage: 'Enter the password to open this workbook.',
  sheetsPasswordLabel: 'Password',
  sheetsPasswordWrong: 'The password is not correct. Try again.',
  sheetsPasswordOpen: 'Open',
  sheetsPasswordCancel: 'Cancel',
  sheetsEncryptionUnsupported: 'This kind of password protection cannot be opened.',
  sheetsEncryptionDamaged: 'This protected workbook is damaged and cannot be opened.',
  sheetsNoticeMacros: 'Macros are kept but not run.',
  sheetsNoticeExternalLinks: 'Cells that point to other files show their last saved values.',
  sheetsNoticeMacrosAndLinks:
    'Macros are kept but not run. Cells that point to other files show their last saved values.',
} as const satisfies Record<keyof typeof zh, string>
