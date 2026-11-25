import type { zh } from './zh'

export const cs = {
  pdfTextHint: 'Klepnutím na prázdné místo přidáte text, klepnutím na text jej upravíte.',
  pdfTextInputLabel: 'Text k přidání',
  pdfTextEditLabel: 'Text k úpravě',
  pdfTextStyleBar: 'Styl textu',
  pdfTextBold: 'Tučné',
  pdfTextSize: 'Velikost textu',
  pdfTextSizeDown: 'Zmenšit text',
  pdfTextSizeUp: 'Zvětšit text',
  pdfTextColor: 'Barva textu',
  pdfTextColorDocument: 'Ponechat barvu dokumentu',
  pdfTextFont: 'Písmo',
  pdfTextFontDocument: 'Písmo dokumentu',
  pdfTextBack: 'Zpět',
  pdfTextDelete: 'Smazat',
  pdfTextDone: 'Hotovo',
  pdfTextCannotDraw: 'Tyto znaky nelze přidat: {chars}',
  pdfTextFontSubstituted: 'Tyto znaky budou zobrazeny jiným písmem: {chars}',
  pdfTextScannedPage: 'Tato stránka neobsahuje text. Můžete pouze přidat nový text.',
  pdfTextNoMatch: 'Tento text nelze upravit: v dokumentu nebyl nalezen.',
  pdfTextOverflow: 'Upravený text by překrýval text pod ním. Zkraťte jej.',
} as const satisfies Record<keyof typeof zh, string>
