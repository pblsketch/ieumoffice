import type { zh } from './zh'

export const en = {
  homeSetEditorsTitle: 'Editors',
  homeSetEditorsHint:
    'Editors you turn off leave the new-document list. Turning all of them off counts as all on.',
  homeSetEditorHwp: 'HWP',
  homeSetEditorMarkdown: 'Markdown',
  homeSetEditorPdfTools: 'PDF tools',
  homeSetCardsTitle: 'New documents on the home screen',
  homeSetCardShow: 'Show {name} on the home screen',
  homeSetCardUp: 'Move {name} up',
  homeSetCardDown: 'Move {name} down',
  homeSetKeepScreenOn: 'Keep the screen on while reading',
  homeSetKeepScreenOnDesc: 'The screen stays on while you read a PDF or EPUB or present a PPT.',
  homeSetFoldersTitle: 'Document folders',
  homeSetFoldersEmpty:
    'No folders linked yet. Link a folder to see its files right in the Folders tab.',
  homeSetFolderLink: 'Link folder',
  homeSetFolderRelink: 'Link again',
  homeSetFolderRemove: 'Remove',
  homeSetFolderRemoveNamed: 'Remove {name}',
  homeSetFolderOk: 'Linked',
  homeSetFolderLost: "This folder can't be reached. If you moved or deleted it, link it again.",
  homeSetFolderRemoveTitle: 'Remove the folder "{name}"?',
  homeSetFolderRemoveBody:
    'The {count} recent and favorite entries for files in this folder will be removed too. The files themselves stay.',
  homeSetBackupsTotal: 'Total {size}',
  homeSetStorageTitle: 'Storage',
  homeSetStorageRecovery: 'Recovery copies',
  homeSetStorageTemp: 'Temporary files',
  homeSetStorageBackups: 'HWP original backups',
  homeSetStorageClearTemp: 'Clear temporary files',
  homeSetStorageClearRecovery: 'Clear all recovery copies',
  homeSetStorageClearTempTitle: 'Clear temporary files?',
  homeSetStorageClearTempBody:
    'This deletes files made briefly while sharing or receiving. Your documents stay as they are.',
  homeSetStorageClearRecoveryTitle: 'Clear all recovery copies?',
  homeSetStorageClearRecoveryBody:
    'Unsaved changes will be lost. The recovery copy of the document open now is kept.',
  homeSetStorageClearAction: 'Clear',
  homeSetStorageCleared: 'Freed {size}.',
  homeSetFailed: "That didn't work. Try again in a moment.",
} as const satisfies Record<keyof typeof zh, string>
