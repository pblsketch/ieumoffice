import type { zh } from './zh'

export const de = {
  pdfTextHint:
    'Tippen Sie auf eine leere Stelle, um Text hinzuzufügen, oder auf Text, um ihn zu bearbeiten.',
  pdfTextInputLabel: 'Hinzuzufügender Text',
  pdfTextEditLabel: 'Zu bearbeitender Text',
  pdfTextStyleBar: 'Textformat',
  pdfTextBold: 'Fett',
  pdfTextSize: 'Schriftgröße',
  pdfTextSizeDown: 'Text verkleinern',
  pdfTextSizeUp: 'Text vergrößern',
  pdfTextColor: 'Textfarbe',
  pdfTextColorDocument: 'Dokumentfarbe beibehalten',
  pdfTextFont: 'Schriftart',
  pdfTextFontDocument: 'Dokumentschrift',
  pdfTextBack: 'Zurück',
  pdfTextDelete: 'Löschen',
  pdfTextDone: 'Fertig',
  pdfTextCannotDraw: 'Diese Zeichen können nicht hinzugefügt werden: {chars}',
  pdfTextFontSubstituted: 'Diese Zeichen werden in einer anderen Schrift dargestellt: {chars}',
  pdfTextScannedPage: 'Diese Seite enthält keinen Text. Sie können nur neuen Text hinzufügen.',
  pdfTextNoMatch: 'Dieser Text kann nicht bearbeitet werden: Er wurde im Dokument nicht gefunden.',
  pdfTextOverflow: 'Der bearbeitete Text würde den Text darunter überlappen. Bitte kürzen Sie ihn.',
} as const satisfies Record<keyof typeof zh, string>
