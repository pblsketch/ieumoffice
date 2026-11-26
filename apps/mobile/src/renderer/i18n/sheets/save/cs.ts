import type { zh } from './zh'

export const cs = {
  sheetsShareFailed: 'Tento soubor se nepodařilo sdílet.',
  sheetsSaveFailed: 'Uložení se nezdařilo. Původní soubor zůstal beze změny.',
  sheetsSaveAsTitle: 'Uložit jako',
  sheetsShareTitle: 'Sdílet jako',
  sheetsFormatWorkbook: 'Sešit aplikace Excel (.xlsx)',
  sheetsFormatWorkbookMacro: 'Sešit aplikace Excel s podporou maker (.xlsm)',
  sheetsFormatCsv: 'CSV (jen aktuální list)',
  sheetsFormatOds: 'Tabulka ODS (kopie sešitu)',
  sheetsFormatPdf: 'PDF (aktuální list)',
  sheetsOdsEncrypted: 'Sešit s heslem nelze exportovat do ODS.',
  sheetsChoiceCancel: 'Zrušit',
  sheetsCsvAskTitle: 'Uložit soubor CSV',
  sheetsCsvAskMessage: 'Soubor CSV uchová jen hodnoty aktuálního listu.',
  sheetsCsvAskCsv: 'Uložit jako CSV (bez formátování a dalších listů)',
  sheetsCsvAskXlsx: 'Uložit jako soubor aplikace Excel',
  sheetsCsvFormulaTitle: 'Vzorce zachovají jen hodnoty',
  sheetsCsvFormulaMessage:
    'Vzorce tohoto listu zůstanou v CSV jen jako vypočtené hodnoty. Chcete-li vzorce zachovat, uložte soubor jako soubor aplikace Excel.',
  sheetsCsvContinue: 'Pokračovat jako CSV',
  sheetsOdsLossTitle: 'Exportovat do ODS',
  sheetsOdsLossMessage:
    'Funkce, které ODS neumí uchovat (vzorce, grafy, obrázky, podmíněné formátování apod.), v počtu {count}, v kopii nebudou.',
  sheetsOdsContinue: 'Pokračovat',
  sheetsOdsUnreadable: 'Soubor ODS nešlo znovu otevřít, proto nebyl zapsán.',
  sheetsOdsFailed: 'Export do ODS se nezdařil.',
  sheetsCopySaved: 'Kopie uložena: {name}',
  sheetsPdfWorking: 'Vytváří se PDF…',
  sheetsPdfFailed: 'PDF se nepodařilo vytvořit.',
  sheetsPdfSkippedVisuals: 'Obrázky nebo grafy ({count}) se nepodařilo vložit do PDF.',
  sheetsPdfMissingGlyphs:
    'Znaky, které písma nemají ({count}), se v PDF zobrazí jako prázdné rámečky.',
  sheetsSaveErrDiskChanged:
    'Jiná aplikace po otevření změnila originál. Nebyl přepsán; použijte Uložit jako.',
  sheetsSaveErrTooLarge:
    'Soubor je příliš velký (asi přes 14 MB), aby se dal zapsat v tomto telefonu. Originál zůstal beze změny.',
  sheetsSaveErrUnreadable: 'Uložený sešit nešlo znovu otevřít, proto originál zůstal beze změny.',
  sheetsSaveErrLockFailed:
    'Sešit nešlo znovu zamknout jeho heslem, proto originál zůstal beze změny.',
  sheetsSaveBusy: 'Probíhá ukládání. Zkuste to znovu, až skončí.',
} as const satisfies Record<keyof typeof zh, string>
