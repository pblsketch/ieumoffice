import type { zh } from './zh'

export const cs = {
  homeFolderListLabel: 'Připojené složky',
  homeFolderEmptyTitle: 'Zatím nejsou připojené žádné složky',
  homeFolderEmptyBody:
    'Připojte složku, kterou často používáte, a její dokumenty a obrázky se zobrazí přímo tady.',
  homeFolderLink: 'Přidat složku',
  homeFolderRelink: 'Připojit znovu',
  homeFolderRelinkNamed: 'Znovu připojit {name}',
  homeFolderOk: 'Připojeno',
  homeFolderLostRevoked: 'Oprávnění k této složce bylo ztraceno. Připojte ji znovu.',
  homeFolderLostMissing:
    'Tuto složku nelze najít. Pokud jste ji přesunuli nebo smazali, připojte ji znovu.',
  homeFolderLost: 'Ke složce nelze přistoupit. Připojte ji znovu.',
  homeFolderMenu: 'Nabídka pro {name}',
  homeFolderRemove: 'Odebrat',
  homeFolderRemoveTitle: 'Odebrat složku „{name}“?',
  homeFolderRemoveBody:
    'Odeberou se i záznamy v nedávných a oblíbených pro soubory z této složky (počet: {count}). Samotné soubory zůstanou.',
  homeFolderRemoved: 'Složka odebrána.',
  homeFolderBack: 'O složku výš',
  homeFolderPath: 'Aktuální složka',
  homeFolderSubfolder: 'Složka',
  homeFolderInsideEmpty: 'V této složce nejsou žádné dokumenty ani obrázky k otevření.',
} as const satisfies Record<keyof typeof zh, string>
