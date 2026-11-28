import type { zh } from './zh'

export const en = {
  homeFolderListLabel: 'Linked folders',
  homeFolderEmptyTitle: 'No folders linked yet',
  homeFolderEmptyBody:
    'Link a folder you use often and its documents and pictures show up right here.',
  homeFolderLink: 'Add folder',
  homeFolderRelink: 'Link again',
  homeFolderRelinkNamed: 'Link {name} again',
  homeFolderOk: 'Linked',
  homeFolderLostRevoked: 'Permission for this folder was lost. Link it again.',
  homeFolderLostMissing: "This folder can't be found. If you moved or deleted it, link it again.",
  homeFolderLost: "The folder can't be reached. Link it again.",
  homeFolderMenu: 'Menu for {name}',
  homeFolderRemove: 'Remove',
  homeFolderRemoveTitle: 'Remove the folder "{name}"?',
  homeFolderRemoveBody:
    'The {count} recent and favorite entries for files in this folder will be removed too. The files themselves stay.',
  homeFolderRemoved: 'Folder removed.',
  homeFolderBack: 'Up one folder',
  homeFolderPath: 'Current folder',
  homeFolderSubfolder: 'Folder',
  homeFolderInsideEmpty: 'This folder has no documents or pictures to open.',
} as const satisfies Record<keyof typeof zh, string>
