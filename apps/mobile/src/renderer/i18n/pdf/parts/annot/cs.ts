import type { zh } from './zh'

export const cs = {
  pdfAnnotHighlight: 'Zvýraznění',
  pdfAnnotUnderline: 'Podtržení',
  pdfAnnotSquiggly: 'Vlnovka',
  pdfAnnotStrikeout: 'Přeškrtnutí',
  pdfAnnotModeSelect: 'Vybrat text',
  pdfAnnotModeNote: 'Umístit poznámku',
  pdfAnnotHintSelect:
    'Text vyberete tažením do strany, nebo dlouhým stisknutím a tažením. Klepnutím na značku změníte její barvu nebo ji odstraníte.',
  pdfAnnotHintNote: 'Klepněte na místo pro poznámku.',
  pdfAnnotPen: 'Zvýrazňovač {n}',
  pdfAnnotColor: 'Barva {n}',
  pdfAnnotRemove: 'Odstranit značku',
  pdfAnnotMarkupTitle: 'Barva značky',
  pdfAnnotClearSelection: 'Zrušit výběr',
  pdfAnnotNoText: 'Na této stránce není žádný text k výběru.',
  pdfAnnotOpenNote: 'Otevřít poznámku',
  pdfAnnotFailed: 'Anotaci se nepodařilo změnit.',
  pdfAnnotNewNote: 'Nová poznámka',
  pdfAnnotReplyPlaceholder: 'Napište odpověď',
} as const satisfies Record<keyof typeof zh, string>
