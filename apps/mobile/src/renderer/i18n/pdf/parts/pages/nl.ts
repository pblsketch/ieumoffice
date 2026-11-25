import type { zh } from './zh'

export const nl = {
  pdfPagesSelected: '{n} geselecteerd',
  pdfPagesNoneSelected: "Tik op pagina's om ze te selecteren",
  pdfPagesSelectAll: 'Alles selecteren',
  pdfPagesClearSelection: 'Selectie wissen',
  pdfPagesRotate: 'Draaien',
  pdfPagesDelete: 'Verwijderen',
  pdfPagesMoveEarlier: 'Eerder',
  pdfPagesMoveLater: 'Later',
  pdfPagesBlankBefore: 'Lege pagina ervoor',
  pdfPagesBlankAfter: 'Lege pagina erna',
  pdfPagesImport: 'Uit een andere pdf',
  pdfPagesPageLabel: 'Pagina {n}',
  pdfPagesBlankLabel: 'Lege pagina',
  pdfPagesDragHandle: 'Sleep om te verplaatsen',
  pdfPagesKeepOne: 'De laatste pagina kan niet worden verwijderd.',
  pdfPagesActionFailed: "De pagina's konden niet worden gewijzigd.",
  pdfPagesDeletedLabel: 'Wordt verwijderd',
  pdfPagesDeletedHint: 'Wordt verwijderd bij opslaan. Ongedaan maken haalt hem terug.',
  pdfPagesMovedLabel: 'Nieuwe volgorde: pagina {n}',
  pdfPagesImportTitle: "Pagina's uit een andere pdf invoegen",
  pdfPagesImportCount: "In te voegen pagina's: {n}",
  pdfPagesImportPlace: 'Waar invoegen',
  pdfPagesImportFront: 'Aan het begin',
  pdfPagesImportAfter: 'Na pagina {n}',
  pdfPagesImportEnd: 'Aan het eind',
  pdfPagesImportConfirmHint:
    "Je wijzigingen tot nu toe worden eerst opgeslagen, daarna worden de pagina's ingevoegd. De ingevoegde pagina's worden direct in het bestand geschreven en kunnen niet ongedaan worden gemaakt.",
  pdfPagesImportConfirm: 'Opslaan en invoegen',
  pdfPagesImportDone: "{n} pagina's ingevoegd.",
  pdfPagesImportFailed: "De pagina's konden niet worden ingevoegd.",
  pdfPagesImportDamaged:
    "Pagina's uit een andere pdf kunnen niet in een beschadigd document worden ingevoegd.",
  pdfPagesImportEncrypted:
    "Pagina's uit een andere pdf kunnen niet in een versleuteld document worden ingevoegd.",
  pdfPagesImportUntitled:
    "Pagina's kunnen niet worden ingevoegd in een nieuw document dat nog nooit is opgeslagen. Sla het eerst op.",
  pdfPagesImportReadOnly: "Pagina's kunnen niet worden ingevoegd in een alleen-lezen document.",
  pdfPagesImportPickEncrypted:
    "De gekozen pdf is met een wachtwoord beveiligd, dus de pagina's kunnen niet worden geïmporteerd.",
  pdfPagesImportPickUnreadable: 'Het gekozen bestand kan niet als pdf worden gelezen.',
} as const satisfies Record<keyof typeof zh, string>
