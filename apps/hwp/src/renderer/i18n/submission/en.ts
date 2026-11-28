import type { zh } from './zh'

export const en = {
  staleDialogTitle: 'Items need updating',
  staleDialogBody:
    'The following items may be out of date after recent edits. Refresh them before continuing?',
  staleActionSave: 'Save',
  staleActionPrint: 'Print',
  staleActionPdf: 'Export PDF',
  staleActionSubmission: 'Save submission copy',
  staleBtnRefreshAll: 'Refresh all',
  staleBtnContinue: 'Continue anyway',
  staleBtnCancel: 'Cancel',
  staleReasonPagesChanged: 'Page numbers changed',
  staleReasonEntriesChanged: 'Entries changed',
  staleKindTocBody: 'Table of contents',
  staleKindTocTable: 'List of tables',
  staleKindTocFigure: 'List of figures',
  staleKindTocEquation: 'List of equations',
  staleKindIndex: 'Index',
  staleKindBibliography: 'Bibliography',
  staleManualConfirmTitle: 'Manual edits detected',
  staleManualConfirmBody: 'Manual edits were found in: {items}. Overwrite them and refresh anyway?',
  staleManualOverwrite: 'Overwrite and refresh',
  staleManualSkip: 'Skip',
  staleRefreshDone: 'Updated {count} items.',
  staleRefreshFailed: 'Could not update some items: {error}',
  staleRefreshBlockedObjects:
    'Skipped refreshing because the TOC or index range contains user objects such as footnotes, pictures, or tables.',
  submissionMenuLabel: 'Save as Submission Copy…',
  submissionMenuDesc: 'Save a separate clean copy without index, citation, or setting marks.',
  submissionSaving: 'Creating submission copy…',
  submissionSaved: 'Saved submission copy: {name}',
  submissionBackupKept: 'Kept a backup of the previous file: {name}',
  submissionSavedTailsLost:
    'Saved submission copy ({name}). Some master pages or memos could not be kept.',
  submissionFailedProtected: 'Password-protected documents cannot be saved as a submission copy.',
  submissionFailedTracked: 'Documents with tracked changes cannot be saved as a submission copy.',
  submissionFailedSameAsOpen:
    'Cannot overwrite an open document with a submission copy. Choose a different file name.',
  submissionFailedStrip:
    'Submission copy was not saved because some internal marks could not be removed: {marks}',
  submissionFailedVerify:
    'Submission copy verification failed ({before} → {after} pages). Try saving in HWPX format instead.',
  submissionFailedExport: 'Could not build submission copy: {error}',
  submissionFailedWrite: 'Could not save submission copy: {error}',
} satisfies Record<keyof typeof zh, string>
