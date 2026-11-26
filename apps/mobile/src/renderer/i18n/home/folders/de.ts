import type { zh } from './zh'

export const de = {
  homeFolderListLabel: 'Verknüpfte Ordner',
  homeFolderEmptyTitle: 'Noch keine Ordner verknüpft',
  homeFolderEmptyBody:
    'Verknüpfen Sie einen häufig genutzten Ordner, dann erscheinen seine Dokumente und Bilder direkt hier.',
  homeFolderLink: 'Ordner verknüpfen',
  homeFolderRelink: 'Neu verknüpfen',
  homeFolderRelinkNamed: '{name} neu verknüpfen',
  homeFolderOk: 'Verknüpft',
  homeFolderLostRevoked:
    'Die Berechtigung für diesen Ordner ist verloren gegangen. Verknüpfen Sie ihn neu.',
  homeFolderLostMissing:
    'Dieser Ordner wurde nicht gefunden. Wenn Sie ihn verschoben oder gelöscht haben, verknüpfen Sie ihn neu.',
  homeFolderLost: 'Der Ordner ist nicht erreichbar. Verknüpfen Sie ihn neu.',
  homeFolderMenu: 'Menü für {name}',
  homeFolderRemove: 'Entfernen',
  homeFolderRemoveTitle: 'Ordner „{name}“ entfernen?',
  homeFolderRemoveBody:
    'Die {count} Einträge unter Zuletzt und Favoriten für Dateien in diesem Ordner werden ebenfalls entfernt. Die Dateien selbst bleiben erhalten.',
  homeFolderRemoved: 'Ordner entfernt.',
  homeFolderBack: 'Übergeordneter Ordner',
  homeFolderPath: 'Aktueller Ordner',
  homeFolderSubfolder: 'Ordner',
  homeFolderInsideEmpty: 'In diesem Ordner gibt es keine Dokumente oder Bilder zum Öffnen.',
} as const satisfies Record<keyof typeof zh, string>
