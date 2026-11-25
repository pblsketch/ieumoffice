import type { zh } from './zh'

export const de = {
  homeSetEditorsTitle: 'Editoren',
  homeSetEditorsHint:
    'Ausgeschaltete Editoren fehlen in der Liste für neue Dokumente. Sind alle aus, gelten alle als an.',
  homeSetEditorHwp: 'HWP',
  homeSetEditorMarkdown: 'Markdown',
  homeSetEditorPdfTools: 'PDF-Werkzeuge',
  homeSetCardsTitle: 'Neue Dokumente auf dem Startbildschirm',
  homeSetCardShow: '{name} auf dem Startbildschirm zeigen',
  homeSetCardUp: '{name} nach oben',
  homeSetCardDown: '{name} nach unten',
  homeSetKeepScreenOn: 'Bildschirm beim Lesen anlassen',
  homeSetKeepScreenOnDesc:
    'Der Bildschirm bleibt an, während Sie ein PDF oder EPUB lesen oder eine PPT vorführen.',
  homeSetFoldersTitle: 'Dokumentordner',
  homeSetFoldersEmpty:
    'Noch keine Ordner verknüpft. Verknüpfte Ordner sehen Sie direkt im Tab „Ordner“.',
  homeSetFolderLink: 'Ordner verknüpfen',
  homeSetFolderRelink: 'Neu verknüpfen',
  homeSetFolderRemove: 'Entfernen',
  homeSetFolderRemoveNamed: '{name} entfernen',
  homeSetFolderOk: 'Verknüpft',
  homeSetFolderLost:
    'Auf diesen Ordner kann nicht zugegriffen werden. Wenn Sie ihn verschoben oder gelöscht haben, verknüpfen Sie ihn neu.',
  homeSetFolderRemoveTitle: 'Ordner „{name}“ entfernen?',
  homeSetFolderRemoveBody:
    'Die {count} Einträge unter Zuletzt und Favoriten für Dateien in diesem Ordner werden ebenfalls entfernt. Die Dateien selbst bleiben erhalten.',
  homeSetBackupsTotal: 'Gesamt {size}',
  homeSetStorageTitle: 'Speicher',
  homeSetStorageRecovery: 'Wiederherstellungskopien',
  homeSetStorageTemp: 'Temporäre Dateien',
  homeSetStorageBackups: 'HWP-Originalsicherungen',
  homeSetStorageClearTemp: 'Temporäre Dateien löschen',
  homeSetStorageClearRecovery: 'Alle Wiederherstellungskopien löschen',
  homeSetStorageClearTempTitle: 'Temporäre Dateien löschen?',
  homeSetStorageClearTempBody:
    'Das löscht Dateien, die beim Teilen oder Empfangen kurz angelegt wurden. Ihre Dokumente bleiben unverändert.',
  homeSetStorageClearRecoveryTitle: 'Alle Wiederherstellungskopien löschen?',
  homeSetStorageClearRecoveryBody:
    'Nicht gespeicherte Änderungen gehen verloren. Die Wiederherstellungskopie des gerade geöffneten Dokuments bleibt erhalten.',
  homeSetStorageClearAction: 'Löschen',
  homeSetStorageCleared: '{size} freigegeben.',
  homeSetFailed: 'Das hat nicht geklappt. Versuchen Sie es gleich noch einmal.',
} as const satisfies Record<keyof typeof zh, string>
