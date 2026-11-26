import type { zh } from './zh'

export const de = {
  homeRunEditorOffTitle: 'Der Editor „{name}“ ist ausgeschaltet',
  homeRunEditorOffBody:
    'Schalten Sie ihn ein, um diese Datei zu öffnen. In den Einstellungen können Sie ihn wieder ausschalten.',
  homeRunEditorOffConfirm: 'Einschalten und öffnen',
  homeRunStripSample: 'Beispieldokument · Schreibgeschützt',
  homeRunStripReceived: 'Empfangene Datei · Schreibgeschützt',
  homeRunStripReadOnly: 'Schreibgeschützt',
  homeRunStripCopy: 'Kopie bearbeiten',
  homeRunStripClose: 'Hinweis schließen',
  homeRunReceiveTitle: 'Empfangene Dateien',
  homeRunReceiveCount: '{count} Dateien',
  homeRunReceiveClose: 'Empfangene Dateien schließen',
  homeRunReceiveOpen: 'Öffnen',
  homeRunReceivePdfOff: 'Die PDF-Werkzeuge sind ausgeschaltet',
  homeRunReceivePdfOn: 'Einschalten und weiter',
  homeRunGuideLabel: 'Einführung',
  homeRunStep: 'Schritt {current} von {total}',
  homeRunWelcomeTitle: 'Willkommen',
  homeRunWelcomeBody:
    'Mit GenOffice öffnen und bearbeiten Sie HWP, PDF, Markdown und mehr. Ohne Konto, ohne Werbung, und Ihre Dokumente bleiben auf diesem Gerät.',
  homeRunNext: 'Weiter',
  homeRunSkip: 'Überspringen',
  homeRunFolderTitle: 'Dokumentordner verknüpfen (optional)',
  homeRunFolderBody:
    'Verknüpfen Sie einen oft genutzten Ordner, dann erscheinen seine Dateien direkt im Tab [Ordner].',
  homeRunFolderPick: 'Ordner auswählen',
  homeRunLater: 'Später',
  homeRunFolderLinked: '✓ Dokumentordner verknüpft · Ändern in den Einstellungen',
  homeRunStart: 'Los geht’s',
  homeRunTipEditButton: 'Zum Ändern auf [Bearbeiten] tippen',
  homeRunTipFlowView:
    'Zum leichteren Lesen auf die Fließansicht umgestellt · Hier geht es zur Seitenansicht',
  homeRunTipFirstEdit:
    'Eine Wiederherstellungskopie wird automatisch angelegt. Das Original wird gespeichert, wenn Sie auf [Fertig] tippen',
  homeRunTipFirstKeyboard: 'Mit [Aa] ändern Sie das Textformat',
} as const satisfies Record<keyof typeof zh, string>
