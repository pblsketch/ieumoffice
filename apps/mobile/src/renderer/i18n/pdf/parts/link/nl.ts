import type { zh } from './zh'

export const nl = {
  pdfLinkPlaceHint: 'Sleep een kader op de pagina waar de koppeling komt',
  pdfLinkEditTitle: 'Koppeling bewerken',
  pdfLinkUrlLabel: 'Webadres (http, https, mailto)',
  pdfLinkPageLabel: 'Of een pagina in dit document (1–{count})',
  pdfLinkUrlInvalid: 'Alleen http-, https- en mailto-adressen kunnen worden gekoppeld',
  pdfLinkPageInvalid: 'Voer een paginanummer van 1 tot {count} in',
  pdfLinkNeedTarget: 'Voer een webadres of een paginanummer in',
  pdfLinkApply: 'Koppeling toevoegen',
  pdfLinkDelete: 'Koppeling verwijderen',
  pdfLinkPending: 'Toe te voegen koppeling: {target}',
  pdfLinkToPage: 'Pagina {page}',
  pdfLinkFailed:
    'De koppeling kon niet worden gewijzigd. Probeer het opnieuw als het opslaan klaar is.',
  pdfLinkUpdate: 'Toepassen',
} as const satisfies Record<keyof typeof zh, string>
