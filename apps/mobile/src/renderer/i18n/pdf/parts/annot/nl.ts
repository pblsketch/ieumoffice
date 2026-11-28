import type { zh } from './zh'

export const nl = {
  pdfAnnotHighlight: 'Markeren',
  pdfAnnotUnderline: 'Onderstrepen',
  pdfAnnotSquiggly: 'Golflijn',
  pdfAnnotStrikeout: 'Doorhalen',
  pdfAnnotModeSelect: 'Tekst selecteren',
  pdfAnnotModeNote: 'Notitie plaatsen',
  pdfAnnotHintSelect:
    'Sleep zijwaarts over de tekst, of houd ingedrukt en sleep daarna, om te selecteren. Tik op een markering om de kleur te wijzigen of haar te verwijderen.',
  pdfAnnotHintNote: 'Tik op de plek voor de notitie.',
  pdfAnnotPen: 'Markeerstift {n}',
  pdfAnnotColor: 'Kleur {n}',
  pdfAnnotRemove: 'Markering verwijderen',
  pdfAnnotMarkupTitle: 'Kleur van markering',
  pdfAnnotClearSelection: 'Selectie opheffen',
  pdfAnnotNoText: 'Deze pagina heeft geen selecteerbare tekst.',
  pdfAnnotOpenNote: 'Notitie openen',
  pdfAnnotFailed: 'De aantekening kon niet worden gewijzigd.',
  pdfAnnotNewNote: 'Nieuwe notitie',
  pdfAnnotReplyPlaceholder: 'Schrijf een antwoord',
} as const satisfies Record<keyof typeof zh, string>
