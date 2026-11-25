import type { zh } from './zh'

export const de = {
  pdfPagesSelected: '{n} ausgewählt',
  pdfPagesNoneSelected: 'Tippen Sie auf Seiten, um sie auszuwählen',
  pdfPagesSelectAll: 'Alle auswählen',
  pdfPagesClearSelection: 'Auswahl aufheben',
  pdfPagesRotate: 'Drehen',
  pdfPagesDelete: 'Löschen',
  pdfPagesMoveEarlier: 'Nach vorn',
  pdfPagesMoveLater: 'Nach hinten',
  pdfPagesBlankBefore: 'Leerseite davor',
  pdfPagesBlankAfter: 'Leerseite danach',
  pdfPagesImport: 'Aus einer PDF',
  pdfPagesPageLabel: 'Seite {n}',
  pdfPagesBlankLabel: 'Leerseite',
  pdfPagesDragHandle: 'Zum Verschieben ziehen',
  pdfPagesKeepOne: 'Die letzte Seite kann nicht gelöscht werden.',
  pdfPagesActionFailed: 'Die Seiten konnten nicht geändert werden.',
  pdfPagesDeletedLabel: 'Wird gelöscht',
  pdfPagesDeletedHint: 'Wird beim Speichern gelöscht. Rückgängig holt sie zurück.',
  pdfPagesMovedLabel: 'Neue Reihenfolge: Seite {n}',
  pdfPagesImportTitle: 'Seiten aus einer anderen PDF einfügen',
  pdfPagesImportCount: 'Einzufügende Seiten: {n}',
  pdfPagesImportPlace: 'Einfügen an',
  pdfPagesImportFront: 'Am Anfang',
  pdfPagesImportAfter: 'Nach Seite {n}',
  pdfPagesImportEnd: 'Am Ende',
  pdfPagesImportConfirmHint:
    'Ihre bisherigen Änderungen werden zuerst gespeichert, dann werden die Seiten eingefügt. Die eingefügten Seiten werden direkt in die Datei geschrieben und lassen sich nicht rückgängig machen.',
  pdfPagesImportConfirm: 'Speichern und einfügen',
  pdfPagesImportDone: '{n} Seiten eingefügt.',
  pdfPagesImportFailed: 'Die Seiten konnten nicht eingefügt werden.',
  pdfPagesImportDamaged:
    'In ein beschädigtes Dokument können keine Seiten aus einer anderen PDF eingefügt werden.',
  pdfPagesImportEncrypted:
    'In ein verschlüsseltes Dokument können keine Seiten aus einer anderen PDF eingefügt werden.',
  pdfPagesImportUntitled:
    'In ein neues, noch nie gespeichertes Dokument können keine Seiten eingefügt werden. Speichern Sie es zuerst.',
  pdfPagesImportReadOnly:
    'In ein schreibgeschütztes Dokument können keine Seiten eingefügt werden.',
  pdfPagesImportPickEncrypted:
    'Die gewählte PDF ist kennwortgeschützt, ihre Seiten können nicht übernommen werden.',
  pdfPagesImportPickUnreadable: 'Die gewählte Datei kann nicht als PDF gelesen werden.',
} as const satisfies Record<keyof typeof zh, string>
