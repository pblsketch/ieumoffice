import type { zh } from './zh'

export const nl = {
  staleDialogTitle: 'Items moeten worden bijgewerkt',
  staleDialogBody:
    'De volgende onderdelen zijn mogelijk verouderd na recente bewerkingen. Vernieuwen voordat u doorgaat?',
  staleActionSave: 'Opslaan',
  staleActionPrint: 'Afdrukken',
  staleActionPdf: 'PDF exporteren',
  staleActionSubmission: 'Inleverkopie opslaan',
  staleBtnRefreshAll: 'Alles vernieuwen',
  staleBtnContinue: 'Toch doorgaan',
  staleBtnCancel: 'Annuleren',
  staleReasonPagesChanged: 'Paginanummers gewijzigd',
  staleReasonEntriesChanged: 'Items gewijzigd',
  staleKindTocBody: 'Inhoudsopgave',
  staleKindTocTable: 'Lijst van tabellen',
  staleKindTocFigure: 'Lijst van figuren',
  staleKindTocEquation: 'Lijst van vergelijkingen',
  staleKindIndex: 'Index',
  staleKindBibliography: 'Bibliografie',
  staleManualConfirmTitle: 'Handmatige bewerkingen gedetecteerd',
  staleManualConfirmBody:
    'Er zijn handmatige bewerkingen gevonden in: {items}. Overschrijven en vernieuwen?',
  staleManualOverwrite: 'Overschrijven en vernieuwen',
  staleManualSkip: 'Overslaan',
  staleRefreshDone: '{count} items bijgewerkt.',
  staleRefreshFailed: 'Sommige items konden niet worden bijgewerkt: {error}',
  staleRefreshBlockedObjects:
    'Vernieuwen overgeslagen omdat het bereik van de inhoudsopgave of index gebruikersobjecten bevat, zoals voetnoten, afbeeldingen of tabellen.',
  submissionMenuLabel: 'Opslaan als inleverkopie…',
  submissionMenuDesc:
    'Slaat een afzonderlijke schone kopie op zonder index-, citaat- of instellingsmarkeringen.',
  submissionSaving: 'Inleverkopie maken…',
  submissionSaved: 'Inleverkopie opgeslagen: {name}',
  submissionBackupKept: 'Er is een back-up van het vorige bestand bewaard: {name}',
  submissionSavedTailsLost:
    'Inleverkopie opgeslagen ({name}). Sommige basispagina’s of opmerkingen konden niet worden behouden.',
  submissionFailedProtected:
    'Met een wachtwoord beveiligde documenten kunnen niet als inleverkopie worden opgeslagen.',
  submissionFailedTracked:
    'Documenten met wijzigingen bijhouden kunnen niet als inleverkopie worden opgeslagen.',
  submissionFailedSameAsOpen:
    'Een geopend document kan niet worden overschreven met een inleverkopie. Kies een andere bestandsnaam.',
  submissionFailedStrip:
    'De inleverkopie is niet opgeslagen omdat sommige interne markeringen niet konden worden verwijderd: {marks}',
  submissionFailedVerify:
    'Verificatie van de inleverkopie is mislukt ({before} → {after} pagina’s). Probeer op te slaan als HWPX.',
  submissionFailedExport: 'Kan inleverkopie niet maken: {error}',
  submissionFailedWrite: 'Kan inleverkopie niet opslaan: {error}',
} satisfies Record<keyof typeof zh, string>
