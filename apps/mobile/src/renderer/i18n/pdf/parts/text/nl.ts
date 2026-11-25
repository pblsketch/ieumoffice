import type { zh } from './zh'

export const nl = {
  pdfTextHint: 'Tik op een lege plek om tekst toe te voegen, of tik op tekst om die te bewerken.',
  pdfTextInputLabel: 'Toe te voegen tekst',
  pdfTextEditLabel: 'Te bewerken tekst',
  pdfTextStyleBar: 'Tekststijl',
  pdfTextBold: 'Vet',
  pdfTextSize: 'Tekstgrootte',
  pdfTextSizeDown: 'Tekst kleiner',
  pdfTextSizeUp: 'Tekst groter',
  pdfTextColor: 'Tekstkleur',
  pdfTextColorDocument: 'Kleur van document behouden',
  pdfTextFont: 'Lettertype',
  pdfTextFontDocument: 'Lettertype van document',
  pdfTextBack: 'Terug',
  pdfTextDelete: 'Verwijderen',
  pdfTextDone: 'Gereed',
  pdfTextCannotDraw: 'Deze tekens kunnen niet worden toegevoegd: {chars}',
  pdfTextFontSubstituted: 'Deze tekens krijgen een ander lettertype: {chars}',
  pdfTextScannedPage: 'Deze pagina bevat geen tekst. Je kunt alleen nieuwe tekst toevoegen.',
  pdfTextNoMatch: 'Deze tekst kan niet worden bewerkt: hij is niet gevonden in het document.',
  pdfTextOverflow: 'De bewerkte tekst zou over de tekst eronder vallen. Maak hem korter.',
} as const satisfies Record<keyof typeof zh, string>
