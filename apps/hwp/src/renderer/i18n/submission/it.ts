import type { zh } from './zh'

export const it = {
  staleDialogTitle: 'Alcuni elementi vanno aggiornati',
  staleDialogBody:
    'I seguenti elementi potrebbero non essere aggiornati dopo le modifiche recenti. Aggiornarli prima di continuare?',
  staleActionSave: 'Salva',
  staleActionPrint: 'Stampa',
  staleActionPdf: 'Esporta PDF',
  staleActionSubmission: 'Salva copia di consegna',
  staleBtnRefreshAll: 'Aggiorna tutto',
  staleBtnContinue: 'Continua comunque',
  staleBtnCancel: 'Annulla',
  staleReasonPagesChanged: 'Numeri di pagina modificati',
  staleReasonEntriesChanged: 'Voci modificate',
  staleKindTocBody: 'Sommario',
  staleKindTocTable: 'Elenco delle tabelle',
  staleKindTocFigure: 'Elenco delle figure',
  staleKindTocEquation: 'Elenco delle equazioni',
  staleKindIndex: 'Indice analitico',
  staleKindBibliography: 'Bibliografia',
  staleManualConfirmTitle: 'Modifiche manuali rilevate',
  staleManualConfirmBody:
    'Sono state rilevate modifiche manuali in: {items}. Sovrascriverle e aggiornare?',
  staleManualOverwrite: 'Sovrascrivi e aggiorna',
  staleManualSkip: 'Salta',
  staleRefreshDone: '{count} elementi aggiornati.',
  staleRefreshFailed: 'Impossibile aggiornare alcuni elementi: {error}',
  staleRefreshBlockedObjects:
    'Aggiornamento saltato perché l’intervallo del sommario o dell’indice contiene oggetti utente come note a piè di pagina, immagini o tabelle.',
  submissionMenuLabel: 'Salva come copia di consegna…',
  submissionMenuDesc:
    'Salva una copia pulita separata senza indicatori di indice, citazione o impostazione.',
  submissionSaving: 'Creazione copia di consegna…',
  submissionSaved: 'Copia di consegna salvata: {name}',
  submissionBackupKept: 'È stata conservata una copia di backup del file precedente: {name}',
  submissionSavedTailsLost:
    'Copia di consegna salvata ({name}). Alcune pagine mastro o commenti potrebbero non essere stati mantenuti.',
  submissionFailedProtected:
    'I documenti protetti da password non possono essere salvati come copia di consegna.',
  submissionFailedTracked:
    'I documenti con revisioni registrate non possono essere salvati come copia di consegna.',
  submissionFailedSameAsOpen:
    'Impossibile sovrascrivere un documento aperto con una copia di consegna. Scegli un altro nome di file.',
  submissionFailedStrip:
    'La copia di consegna non è stata salvata perché non è stato possibile rimuovere alcuni indicatori interni: {marks}',
  submissionFailedVerify:
    'Verifica della copia di consegna non riuscita ({before} → {after} pagine). Riprova in formato HWPX.',
  submissionFailedExport: 'Impossibile creare la copia di consegna: {error}',
  submissionFailedWrite: 'Impossibile salvare la copia di consegna: {error}',
} satisfies Record<keyof typeof zh, string>
