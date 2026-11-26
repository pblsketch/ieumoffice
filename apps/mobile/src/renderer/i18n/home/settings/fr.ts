import type { zh } from './zh'

export const fr = {
  homeSetEditorsTitle: 'Éditeurs',
  homeSetEditorsHint:
    'Les éditeurs désactivés disparaissent de la liste des nouveaux documents. Tout désactiver revient à tout activer.',
  homeSetEditorHwp: 'HWP',
  homeSetEditorMarkdown: 'Markdown',
  homeSetEditorPdfTools: 'Outils PDF',
  homeSetCardsTitle: "Nouveaux documents sur l'écran d'accueil",
  homeSetCardShow: "Afficher {name} sur l'écran d'accueil",
  homeSetCardUp: 'Monter {name}',
  homeSetCardDown: 'Descendre {name}',
  homeSetKeepScreenOn: "Garder l'écran allumé pendant la lecture",
  homeSetKeepScreenOnDesc:
    "L'écran reste allumé pendant que vous lisez un PDF ou un EPUB, ou que vous présentez un PPT.",
  homeSetFoldersTitle: 'Dossiers de documents',
  homeSetFoldersEmpty:
    "Aucun dossier lié. Liez un dossier pour voir ses fichiers directement dans l'onglet Dossiers.",
  homeSetFolderLink: 'Lier un dossier',
  homeSetFolderRelink: 'Lier à nouveau',
  homeSetFolderRemove: 'Retirer',
  homeSetFolderRemoveNamed: 'Retirer {name}',
  homeSetFolderOk: 'Lié',
  homeSetFolderLost:
    "Ce dossier est inaccessible. Si vous l'avez déplacé ou supprimé, liez-le à nouveau.",
  homeSetFolderRemoveTitle: 'Retirer le dossier « {name} » ?',
  homeSetFolderRemoveBody:
    'Les {count} entrées récentes et favorites des fichiers de ce dossier seront aussi retirées. Les fichiers eux-mêmes restent en place.',
  homeSetBackupsTotal: 'Total {size}',
  homeSetStorageTitle: 'Stockage',
  homeSetStorageRecovery: 'Copies de récupération',
  homeSetStorageTemp: 'Fichiers temporaires',
  homeSetStorageBackups: 'Sauvegardes originales HWP',
  homeSetStorageClearTemp: 'Effacer les fichiers temporaires',
  homeSetStorageClearRecovery: 'Effacer toutes les copies de récupération',
  homeSetStorageClearTempTitle: 'Effacer les fichiers temporaires ?',
  homeSetStorageClearTempBody:
    "Cela supprime les fichiers créés brièvement lors d'un partage ou d'une réception. Vos documents ne changent pas.",
  homeSetStorageClearRecoveryTitle: 'Effacer toutes les copies de récupération ?',
  homeSetStorageClearRecoveryBody:
    'Les modifications non enregistrées seront perdues. La copie de récupération du document ouvert est conservée.',
  homeSetStorageClearAction: 'Effacer',
  homeSetStorageCleared: '{size} libérés.',
  homeSetFailed: "L'opération a échoué. Réessayez dans un instant.",
} as const satisfies Record<keyof typeof zh, string>
