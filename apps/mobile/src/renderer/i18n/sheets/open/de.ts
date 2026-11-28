import type { zh } from './zh'

export const de = {
  sheetsEditorName: 'Excel',
  sheetsLoading: 'Raster wird geladen…',
  sheetsOpening: 'Arbeitsmappe wird geöffnet… Große Dateien brauchen etwas Zeit.',
  sheetsPasswordTitle: 'Kennwortgeschützte Arbeitsmappe',
  sheetsPasswordMessage: 'Geben Sie das Kennwort ein, um diese Arbeitsmappe zu öffnen.',
  sheetsPasswordLabel: 'Kennwort',
  sheetsPasswordWrong: 'Das Kennwort ist falsch. Versuchen Sie es erneut.',
  sheetsPasswordOpen: 'Öffnen',
  sheetsPasswordCancel: 'Abbrechen',
  sheetsEncryptionUnsupported: 'Diese Art von Kennwortschutz kann nicht geöffnet werden.',
  sheetsEncryptionDamaged:
    'Diese geschützte Arbeitsmappe ist beschädigt und kann nicht geöffnet werden.',
  sheetsNoticeMacros: 'Makros bleiben erhalten, werden aber nicht ausgeführt.',
  sheetsNoticeExternalLinks:
    'Zellen, die auf andere Dateien verweisen, zeigen ihren zuletzt gespeicherten Wert.',
  sheetsNoticeMacrosAndLinks:
    'Makros bleiben erhalten, werden aber nicht ausgeführt. Zellen, die auf andere Dateien verweisen, zeigen ihren zuletzt gespeicherten Wert.',
} as const satisfies Record<keyof typeof zh, string>
