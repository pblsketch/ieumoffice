import type { zh } from './zh'

export const fr = {
  homeFolderListLabel: 'Dossiers liés',
  homeFolderEmptyTitle: 'Aucun dossier lié pour l’instant',
  homeFolderEmptyBody:
    'Liez un dossier que vous utilisez souvent : ses documents et ses images s’afficheront ici.',
  homeFolderLink: 'Lier un dossier',
  homeFolderRelink: 'Lier à nouveau',
  homeFolderRelinkNamed: 'Lier {name} à nouveau',
  homeFolderOk: 'Lié',
  homeFolderLostRevoked: "L'autorisation d'accès à ce dossier a été perdue. Liez-le à nouveau.",
  homeFolderLostMissing:
    "Ce dossier est introuvable. Si vous l'avez déplacé ou supprimé, liez-le à nouveau.",
  homeFolderLost: 'Le dossier est inaccessible. Liez-le à nouveau.',
  homeFolderMenu: 'Menu de {name}',
  homeFolderRemove: 'Retirer',
  homeFolderRemoveTitle: 'Retirer le dossier « {name} » ?',
  homeFolderRemoveBody:
    'Les {count} entrées récentes et favorites des fichiers de ce dossier seront aussi retirées. Les fichiers eux-mêmes restent en place.',
  homeFolderRemoved: 'Dossier retiré.',
  homeFolderBack: 'Dossier parent',
  homeFolderPath: 'Dossier actuel',
  homeFolderSubfolder: 'Dossier',
  homeFolderInsideEmpty: 'Ce dossier ne contient aucun document ni image à ouvrir.',
} as const satisfies Record<keyof typeof zh, string>
