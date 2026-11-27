import type { zh } from './zh'

export const de = {
  staleDialogTitle: 'Einträge müssen aktualisiert werden',
  staleDialogBody:
    'Die folgenden Elemente sind nach den letzten Änderungen möglicherweise veraltet. Vor dem Fortfahren aktualisieren?',
  staleActionSave: 'Speichern',
  staleActionPrint: 'Drucken',
  staleActionPdf: 'Als PDF exportieren',
  staleActionSubmission: 'Einreichungskopie speichern',
  staleBtnRefreshAll: 'Alle aktualisieren',
  staleBtnContinue: 'Trotzdem fortfahren',
  staleBtnCancel: 'Abbrechen',
  staleReasonPagesChanged: 'Seitenzahlen geändert',
  staleReasonEntriesChanged: 'Einträge geändert',
  staleKindTocBody: 'Inhaltsverzeichnis',
  staleKindTocTable: 'Tabellenverzeichnis',
  staleKindTocFigure: 'Abbildungsverzeichnis',
  staleKindTocEquation: 'Formelverzeichnis',
  staleKindIndex: 'Index',
  staleKindBibliography: 'Literaturverzeichnis',
  staleManualConfirmTitle: 'Manuelle Änderungen erkannt',
  staleManualConfirmBody:
    'Manuelle Änderungen wurden gefunden in: {items}. Überschreiben und trotzdem aktualisieren?',
  staleManualOverwrite: 'Überschreiben und aktualisieren',
  staleManualSkip: 'Überspringen',
  staleRefreshDone: '{count} Elemente aktualisiert.',
  staleRefreshFailed: 'Einige Elemente konnten nicht aktualisiert werden: {error}',
  submissionMenuLabel: 'Als Einreichungskopie speichern…',
  submissionMenuDesc:
    'Speichert eine bereinigte Kopie ohne Index-, Zitat- und Einstellungsmarken.',
  submissionSaving: 'Einreichungskopie wird erstellt…',
  submissionSaved: 'Einreichungskopie gespeichert: {name}',
  submissionSavedTailsLost:
    'Einreichungskopie gespeichert ({name}). Einige Musterseiten oder Kommentare konnten nicht übernommen werden.',
  submissionFailedProtected:
    'Kennwortgeschützte Dokumente können nicht als Einreichungskopie gespeichert werden.',
  submissionFailedTracked:
    'Dokumente mit Änderungsverfolgung können nicht als Einreichungskopie gespeichert werden.',
  submissionFailedVerify:
    'Prüfung der Einreichungskopie fehlgeschlagen ({before} → {after} Seiten). Versuchen Sie es im HWPX-Format.',
  submissionFailedExport: 'Einreichungskopie konnte nicht erstellt werden: {error}',
  submissionFailedWrite: 'Einreichungskopie konnte nicht gespeichert werden: {error}',
} satisfies Record<keyof typeof zh, string>
