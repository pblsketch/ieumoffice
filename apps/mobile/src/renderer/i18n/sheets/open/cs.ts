import type { zh } from './zh'

export const cs = {
  sheetsEditorName: 'Excel',
  sheetsLoading: 'Načítání mřížky…',
  sheetsOpening: 'Otevírání sešitu… Velké soubory chvíli trvají.',
  sheetsPasswordTitle: 'Sešit chráněný heslem',
  sheetsPasswordMessage: 'Zadejte heslo pro otevření tohoto sešitu.',
  sheetsPasswordLabel: 'Heslo',
  sheetsPasswordWrong: 'Heslo není správné. Zkuste to znovu.',
  sheetsPasswordOpen: 'Otevřít',
  sheetsPasswordCancel: 'Zrušit',
  sheetsEncryptionUnsupported: 'Tento typ ochrany heslem nelze otevřít.',
  sheetsEncryptionDamaged: 'Tento chráněný sešit je poškozený a nelze jej otevřít.',
  sheetsNoticeMacros: 'Makra zůstávají zachována, ale nespouštějí se.',
  sheetsNoticeExternalLinks:
    'Buňky odkazující na jiné soubory zobrazují naposledy uložené hodnoty.',
  sheetsNoticeMacrosAndLinks:
    'Makra zůstávají zachována, ale nespouštějí se. Buňky odkazující na jiné soubory zobrazují naposledy uložené hodnoty.',
} as const satisfies Record<keyof typeof zh, string>
