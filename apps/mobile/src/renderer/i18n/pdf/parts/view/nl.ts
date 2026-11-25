import type { zh } from './zh'

export const nl = {
  pdfViewEditorName: 'PDF-editor',
  pdfViewLoading: 'Openen…',
  pdfViewOpenFailed:
    'Deze pdf kan niet worden geopend. Het bestand is mogelijk beschadigd of geen pdf.',
  pdfViewCertEncrypted:
    'Deze PDF is beveiligd met een certificaat, niet met een wachtwoord. Open hem in de app die hem heeft uitgegeven.',
  pdfViewBlankUnavailable: 'Kan geen nieuwe pdf maken.',
  pdfViewPagesFailed: 'Sommige pagina’s konden niet worden gelezen en worden leeg weergegeven.',
  pdfViewPageBroken: 'Deze pagina kan niet worden weergegeven',
  pdfViewPageLabel: 'Pagina {page}',
  pdfViewPageIndicator: 'Pagina {page} van {count}',
  pdfViewInternalLink: 'Ga naar de gekoppelde pagina',
  pdfViewPasswordTitle: 'Deze PDF is versleuteld',
  pdfViewPasswordBody:
    '"{name}" is met een wachtwoord beveiligd. Voer het wachtwoord in om het te openen.',
  pdfViewPasswordLabel: 'Wachtwoord',
  pdfViewPasswordPlaceholder: 'Voer het wachtwoord in om te openen',
  pdfViewPasswordShow: 'Wachtwoord tonen',
  pdfViewPasswordHide: 'Wachtwoord verbergen',
  pdfViewPasswordOpen: 'Openen',
  pdfViewPasswordWrong: 'Onjuist wachtwoord, probeer het opnieuw',
  pdfViewReadOnlyEncrypted: 'Versleuteld document is alleen-lezen',
  pdfViewReadOnlyDamaged: 'Beschadigd bestand: onleesbare pagina’s zijn leeg, alleen-lezen',
  pdfViewReadOnlyNotWritable:
    'Dit bestand kan niet op zijn plaats worden opgeslagen en is daarom alleen-lezen',
  pdfViewSearch: 'Zoeken',
  pdfViewSearchPlaceholder: 'Zoeken in document',
  pdfViewSearching: 'Zoeken…',
  pdfViewSearchNone: 'Geen resultaten',
  pdfViewSearchPrev: 'Vorige',
  pdfViewSearchNext: 'Volgende',
  pdfViewSearchClose: 'Zoeken sluiten',
  pdfViewOutline: 'Overzicht',
  pdfViewOutlineEmpty: 'Dit document heeft geen overzicht',
  pdfViewGoToPage: 'Ga naar pagina',
  pdfViewGoToPageLabel: 'Paginanummer (1–{count})',
  pdfViewGoToPageGo: 'Ga',
  pdfViewGoToPageInvalid: 'Voer een getal van 1 tot {count} in',
} as const satisfies Record<keyof typeof zh, string>
