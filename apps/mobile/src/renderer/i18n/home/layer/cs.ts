import type { zh } from './zh'

export const cs = {
  homeRunEditorOffTitle: 'Editor {name} je vypnutý',
  homeRunEditorOffBody:
    'Zapněte ho, abyste mohli tento soubor otevřít. Znovu ho vypnete v nastavení.',
  homeRunEditorOffConfirm: 'Zapnout a otevřít',
  homeRunStripSample: 'Ukázkový dokument · Jen pro čtení',
  homeRunStripReceived: 'Přijatý soubor · Jen pro čtení',
  homeRunStripReadOnly: 'Jen pro čtení',
  homeRunStripCopy: 'Upravit kopii',
  homeRunStripClose: 'Zavřít upozornění',
  homeRunReceiveTitle: 'Přijaté soubory',
  homeRunReceiveCount: 'Souborů: {count}',
  homeRunReceiveClose: 'Zavřít přijaté soubory',
  homeRunReceiveOpen: 'Otevřít',
  homeRunReceivePdfOff: 'Nástroje PDF jsou vypnuté',
  homeRunReceivePdfOn: 'Zapnout a pokračovat',
  homeRunGuideLabel: 'Úvodní průvodce',
  homeRunStep: 'Krok {current} z {total}',
  homeRunWelcomeTitle: 'Vítejte',
  homeRunWelcomeBody:
    'V GenOffice otevřete a upravíte dokumenty HWP, PDF, Markdown a další. Bez účtu, bez reklam a dokumenty zůstávají v tomto zařízení.',
  homeRunNext: 'Další',
  homeRunSkip: 'Přeskočit',
  homeRunFolderTitle: 'Propojit složku s dokumenty (volitelné)',
  homeRunFolderBody:
    'Propojte složku, kterou často používáte, a její soubory se hned zobrazí na kartě [Složky].',
  homeRunFolderPick: 'Vybrat složku',
  homeRunLater: 'Později',
  homeRunFolderLinked: '✓ Složka s dokumenty propojena · Změníte ji v nastavení',
  homeRunStart: 'Začít',
  homeRunTipEditButton: 'Chcete-li provést změny, klepněte na [Upravit]',
  homeRunTipFlowView:
    'Přepnuto na plynulé zobrazení pro snazší čtení · Zobrazení stránky najdete tady',
  homeRunTipFirstEdit:
    'Kopie pro obnovení se vytváří automaticky. Originál se uloží, když klepnete na [Hotovo]',
  homeRunTipFirstKeyboard: 'Formát textu změníte tlačítkem [Aa]',
} as const satisfies Record<keyof typeof zh, string>
