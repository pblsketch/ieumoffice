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
  homeRunStep: 'Step {current} of {total}',
  homeRunWelcomeTitle: 'Welcome',
  homeRunWelcomeBody:
    'Open and edit HWP, PDF, Markdown and more with GenOffice. No account, no ads, and your documents stay on this device.',
  homeRunNext: 'Next',
  homeRunSkip: 'Skip',
  homeRunFolderTitle: 'Link a document folder (optional)',
  homeRunFolderBody:
    'Link a folder you use often and its files show up right in the [Folders] tab.',
  homeRunFolderPick: 'Choose a folder',
  homeRunLater: 'Later',
  homeRunFolderLinked: '✓ Document folder linked · Change it in Settings',
  homeRunStart: 'Get started',
  homeRunTipEditButton: 'To make changes, tap [Edit]',
  homeRunTipFlowView: 'Switched to flow view for easier reading · Page view is here',
  homeRunTipFirstEdit:
    'A recovery copy is made automatically. The original is saved when you tap [Done]',
  homeRunTipFirstKeyboard: 'Change the text style with [Aa]',
} as const satisfies Record<keyof typeof zh, string>
