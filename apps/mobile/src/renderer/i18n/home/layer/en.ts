import type { zh } from './zh'

export const en = {
  homeRunEditorOffTitle: 'The {name} editor is turned off',
  homeRunEditorOffBody: 'Turn it on to open this file. You can turn it off again in Settings.',
  homeRunEditorOffConfirm: 'Turn on and open',
  homeRunStripSample: 'Sample document · Read-only',
  homeRunStripReceived: 'Received file · Read-only',
  homeRunStripReadOnly: 'Read-only',
  homeRunStripCopy: 'Edit a copy',
  homeRunStripClose: 'Close notice',
  homeRunReceiveTitle: 'Received files',
  homeRunReceiveCount: '{count} files',
  homeRunReceiveClose: 'Close received files',
  homeRunReceiveOpen: 'Open',
  homeRunReceivePdfOff: 'PDF tools are turned off',
  homeRunReceivePdfOn: 'Turn on and continue',
  homeRunGuideLabel: 'Welcome guide',
  homeRunWelcomeTitle: 'Welcome',
  homeRunWelcomeBody:
    'Open and edit HWP, PDF, Markdown and more with GenOffice. No account, no ads, and your documents stay on this device.',
  homeRunStart: 'Get started',
  homeRunTipEditButton: 'To make changes, tap [Edit]',
  homeRunTipFlowView: 'To fit text to the screen, tap [Reading view]',
  homeRunTipFirstEdit:
    'A recovery copy is made automatically. The original is saved when you tap [Done]',
  homeRunTipFirstKeyboard: 'Change the text style with [Aa]',
} as const satisfies Record<keyof typeof zh, string>
