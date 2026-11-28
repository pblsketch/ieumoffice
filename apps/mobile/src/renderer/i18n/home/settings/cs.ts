import type { zh } from './zh'

export const cs = {
  homeSetEditorsTitle: 'Editory',
  homeSetEditorsHint:
    'Vypnuté editory zmizí ze seznamu nových dokumentů. Když vypnete všechny, berou se všechny jako zapnuté.',
  homeSetEditorHwp: 'HWP',
  homeSetEditorMarkdown: 'Markdown',
  homeSetEditorPdfTools: 'Nástroje PDF',
  homeSetCardsTitle: 'Nové dokumenty na domovské obrazovce',
  homeSetCardShow: 'Zobrazit {name} na domovské obrazovce',
  homeSetCardUp: 'Posunout {name} nahoru',
  homeSetCardDown: 'Posunout {name} dolů',
  homeSetKeepScreenOn: 'Nezhasínat obrazovku při čtení',
  homeSetKeepScreenOnDesc: 'Obrazovka nezhasne, když čtete PDF nebo EPUB nebo prezentujete PPT.',
  homeSetFoldersTitle: 'Složky s dokumenty',
  homeSetFoldersEmpty:
    'Zatím nejsou připojené žádné složky. Po připojení uvidíte soubory hned na kartě Složky.',
  homeSetFolderLink: 'Připojit složku',
  homeSetFolderRelink: 'Připojit znovu',
  homeSetFolderRemove: 'Odebrat',
  homeSetFolderRemoveNamed: 'Odebrat {name}',
  homeSetFolderOk: 'Připojeno',
  homeSetFolderLost:
    'K této složce nelze získat přístup. Pokud jste ji přesunuli nebo smazali, připojte ji znovu.',
  homeSetFolderRemoveTitle: 'Odebrat složku „{name}“?',
  homeSetFolderRemoveBody:
    'Odeberou se i záznamy v nedávných a oblíbených pro soubory z této složky (počet: {count}). Samotné soubory zůstanou.',
  homeSetBackupsTotal: 'Celkem {size}',
  homeSetStorageTitle: 'Úložiště',
  homeSetStorageRecovery: 'Kopie pro obnovení',
  homeSetStorageTemp: 'Dočasné soubory',
  homeSetStorageBackups: 'Zálohy originálních HWP',
  homeSetStorageClearTemp: 'Smazat dočasné soubory',
  homeSetStorageClearRecovery: 'Smazat všechny kopie pro obnovení',
  homeSetStorageClearTempTitle: 'Smazat dočasné soubory?',
  homeSetStorageClearTempBody:
    'Smažou se soubory vytvořené na chvíli při sdílení nebo přijímání. Vaše dokumenty zůstanou beze změny.',
  homeSetStorageClearRecoveryTitle: 'Smazat všechny kopie pro obnovení?',
  homeSetStorageClearRecoveryBody:
    'Neuložené změny se ztratí. Kopie pro obnovení právě otevřeného dokumentu zůstane.',
  homeSetStorageClearAction: 'Smazat',
  homeSetStorageCleared: 'Uvolněno {size}.',
  homeSetFailed: 'Nepodařilo se to. Zkuste to za chvíli znovu.',
} as const satisfies Record<keyof typeof zh, string>
