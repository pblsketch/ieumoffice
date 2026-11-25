import type { zh } from './zh'

export const it = {
  pdfPagesSelected: '{n} selezionate',
  pdfPagesNoneSelected: 'Tocca le pagine per selezionarle',
  pdfPagesSelectAll: 'Seleziona tutto',
  pdfPagesClearSelection: 'Annulla selezione',
  pdfPagesRotate: 'Ruota',
  pdfPagesDelete: 'Elimina',
  pdfPagesMoveEarlier: 'Prima',
  pdfPagesMoveLater: 'Dopo',
  pdfPagesBlankBefore: 'Pagina vuota prima',
  pdfPagesBlankAfter: 'Pagina vuota dopo',
  pdfPagesImport: 'Da un altro PDF',
  pdfPagesPageLabel: 'Pagina {n}',
  pdfPagesBlankLabel: 'Pagina vuota',
  pdfPagesDragHandle: 'Trascina per spostare',
  pdfPagesKeepOne: "L'ultima pagina non può essere eliminata.",
  pdfPagesActionFailed: 'Impossibile modificare le pagine.',
  pdfPagesDeletedLabel: 'Da eliminare',
  pdfPagesDeletedHint: 'Eliminata al salvataggio. Annulla la ripristina.',
  pdfPagesMovedLabel: 'Nuovo ordine: pagina {n}',
  pdfPagesImportTitle: 'Inserisci pagine da un altro PDF',
  pdfPagesImportCount: 'Pagine da inserire: {n}',
  pdfPagesImportPlace: 'Dove inserire',
  pdfPagesImportFront: "All'inizio",
  pdfPagesImportAfter: 'Dopo la pagina {n}',
  pdfPagesImportEnd: 'Alla fine',
  pdfPagesImportConfirmHint:
    'Le modifiche fatte finora vengono prima salvate, poi le pagine vengono inserite. Le pagine inserite sono scritte direttamente nel file e non si possono annullare.',
  pdfPagesImportConfirm: 'Salva e inserisci',
  pdfPagesImportDone: '{n} pagine inserite.',
  pdfPagesImportFailed: 'Impossibile inserire le pagine.',
  pdfPagesImportDamaged:
    'Non è possibile inserire pagine di un altro PDF in un documento danneggiato.',
  pdfPagesImportEncrypted:
    'Non è possibile inserire pagine di un altro PDF in un documento crittografato.',
  pdfPagesImportUntitled:
    'Non è possibile inserire pagine in un nuovo documento mai salvato. Salvalo prima.',
  pdfPagesImportReadOnly: 'Non è possibile inserire pagine in un documento di sola lettura.',
  pdfPagesImportPickEncrypted:
    'Il PDF scelto è protetto da password, quindi le sue pagine non possono essere importate.',
  pdfPagesImportPickUnreadable: 'Il file scelto non può essere letto come PDF.',
} as const satisfies Record<keyof typeof zh, string>
