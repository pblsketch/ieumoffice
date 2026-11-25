import type { zh } from './zh'

export const nl = {
  pdfEditPen: 'Pen',
  pdfEditHighlighter: 'Markeerstift',
  pdfEditTextBox: 'Tekstvak',
  pdfEditSign: 'Ondertekenen',
  pdfEditPages: "Pagina's ordenen",
  pdfEditLink: 'Link invoegen',
  pdfEditSaveFailed:
    'Opslaan is mislukt. Je wijzigingen blijven bewaard en het bestand is niet gewijzigd.',
  pdfEditSaveSkipped: 'Sommige tekstbewerkingen op pagina {pages} konden niet worden opgeslagen.',
  pdfEditShareFailed: 'Delen is mislukt.',
  pdfEditReloadFailed:
    'Opgeslagen, maar het document kon niet opnieuw worden geladen. Open het bestand opnieuw.',
  pdfEditSignatureUnavailable: 'Ondertekenen is nog niet beschikbaar.',
  pdfEditSaveAsHint:
    'Kies hoe markeringen, notities en tekeningen in de kopie worden behandeld. “In pagina’s bakken” bakt ook formuliervelden in; “Annotaties weglaten” behoudt koppelingen en formuliervelden.',
  pdfEditKeepAnnots: 'Annotaties behouden (bewerkbaar in andere apps)',
  pdfEditFlattenAnnots: 'In pagina’s bakken (zichtbaar in elke app)',
  pdfEditStripAnnots: 'Annotaties weglaten (koppelingen en velden blijven)',
  pdfEditSaveVerifyFailed:
    'De wijzigingen op pagina {pages} konden niet volledig worden weggeschreven; het opslaan is geannuleerd en het bestand is ongewijzigd. Maak de betreffende bewerking ongedaan en probeer het opnieuw',
} as const satisfies Record<keyof typeof zh, string>
