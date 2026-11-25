import type { zh } from './zh'

export const it = {
  homeSetEditorsTitle: 'Editor',
  homeSetEditorsHint:
    "Gli editor disattivati spariscono dall'elenco dei nuovi documenti. Disattivarli tutti equivale ad averli tutti attivi.",
  homeSetEditorHwp: 'HWP',
  homeSetEditorMarkdown: 'Markdown',
  homeSetEditorPdfTools: 'Strumenti PDF',
  homeSetCardsTitle: 'Nuovi documenti nella schermata Home',
  homeSetCardShow: 'Mostra {name} nella schermata Home',
  homeSetCardUp: 'Sposta su {name}',
  homeSetCardDown: 'Sposta giù {name}',
  homeSetKeepScreenOn: 'Tieni acceso lo schermo durante la lettura',
  homeSetKeepScreenOnDesc:
    'Lo schermo resta acceso mentre leggi un PDF o un EPUB o presenti un PPT.',
  homeSetFoldersTitle: 'Cartelle dei documenti',
  homeSetFoldersEmpty:
    'Nessuna cartella collegata. Collega una cartella per vederne i file direttamente nella scheda Cartelle.',
  homeSetFolderLink: 'Collega cartella',
  homeSetFolderRelink: 'Ricollega',
  homeSetFolderRemove: 'Rimuovi',
  homeSetFolderRemoveNamed: 'Rimuovi {name}',
  homeSetFolderOk: 'Collegata',
  homeSetFolderLost:
    "Impossibile accedere a questa cartella. Se l'hai spostata o eliminata, ricollegala.",
  homeSetFolderRemoveTitle: 'Rimuovere la cartella «{name}»?',
  homeSetFolderRemoveBody:
    'Verranno rimosse anche le {count} voci recenti e preferite dei file di questa cartella. I file restano dove sono.',
  homeSetBackupsTotal: 'Totale {size}',
  homeSetStorageTitle: 'Spazio di archiviazione',
  homeSetStorageRecovery: 'Copie di ripristino',
  homeSetStorageTemp: 'File temporanei',
  homeSetStorageBackups: 'Backup originali HWP',
  homeSetStorageClearTemp: 'Cancella file temporanei',
  homeSetStorageClearRecovery: 'Cancella tutte le copie di ripristino',
  homeSetStorageClearTempTitle: 'Cancellare i file temporanei?',
  homeSetStorageClearTempBody:
    'Vengono eliminati i file creati per poco durante la condivisione o la ricezione. I tuoi documenti non cambiano.',
  homeSetStorageClearRecoveryTitle: 'Cancellare tutte le copie di ripristino?',
  homeSetStorageClearRecoveryBody:
    'Le modifiche non salvate andranno perse. La copia di ripristino del documento aperto ora viene mantenuta.',
  homeSetStorageClearAction: 'Cancella',
  homeSetStorageCleared: 'Liberati {size}.',
  homeSetFailed: "Non è stato possibile completare l'operazione. Riprova tra poco.",
} as const satisfies Record<keyof typeof zh, string>
