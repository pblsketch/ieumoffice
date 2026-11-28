import type { zh } from './zh'

export const fr = {
  pdfPagesSelected: '{n} sélectionnée(s)',
  pdfPagesNoneSelected: 'Touchez les pages pour les sélectionner',
  pdfPagesSelectAll: 'Tout sélectionner',
  pdfPagesClearSelection: 'Désélectionner',
  pdfPagesRotate: 'Pivoter',
  pdfPagesDelete: 'Supprimer',
  pdfPagesMoveEarlier: 'Avant',
  pdfPagesMoveLater: 'Après',
  pdfPagesBlankBefore: 'Page vierge avant',
  pdfPagesBlankAfter: 'Page vierge après',
  pdfPagesImport: 'Depuis un PDF',
  pdfPagesPageLabel: 'Page {n}',
  pdfPagesBlankLabel: 'Page vierge',
  pdfPagesDragHandle: 'Faire glisser pour déplacer',
  pdfPagesKeepOne: 'La dernière page ne peut pas être supprimée.',
  pdfPagesActionFailed: 'Impossible de modifier les pages.',
  pdfPagesDeletedLabel: 'À supprimer',
  pdfPagesDeletedHint: "Supprimée à l'enregistrement. Annuler la rétablit.",
  pdfPagesMovedLabel: 'Nouvel ordre : page {n}',
  pdfPagesImportTitle: "Insérer des pages d'un autre PDF",
  pdfPagesImportCount: 'Pages à insérer : {n}',
  pdfPagesImportPlace: 'Où insérer',
  pdfPagesImportFront: 'Au début',
  pdfPagesImportAfter: 'Après la page {n}',
  pdfPagesImportEnd: 'À la fin',
  pdfPagesImportConfirmHint:
    "Vos modifications sont d'abord enregistrées, puis les pages sont insérées. Les pages insérées sont écrites directement dans le fichier et ne peuvent pas être annulées.",
  pdfPagesImportConfirm: 'Enregistrer et insérer',
  pdfPagesImportDone: '{n} pages insérées.',
  pdfPagesImportFailed: "Impossible d'insérer les pages.",
  pdfPagesImportDamaged:
    "Impossible d'insérer des pages d'un autre PDF dans un document endommagé.",
  pdfPagesImportEncrypted:
    "Impossible d'insérer des pages d'un autre PDF dans un document chiffré.",
  pdfPagesImportUntitled:
    "Impossible d'insérer des pages dans un nouveau document jamais enregistré. Enregistrez-le d'abord.",
  pdfPagesImportReadOnly: "Impossible d'insérer des pages dans un document en lecture seule.",
  pdfPagesImportPickEncrypted:
    'Le PDF choisi est protégé par mot de passe : ses pages ne peuvent pas être importées.',
  pdfPagesImportPickUnreadable: 'Le fichier choisi ne peut pas être lu comme un PDF.',
} as const satisfies Record<keyof typeof zh, string>
