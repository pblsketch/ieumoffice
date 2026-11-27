import type { zh } from './zh'

export const it = {
  homeFolderListLabel: 'Cartelle collegate',
  homeFolderEmptyTitle: 'Nessuna cartella collegata',
  homeFolderEmptyBody:
    'Collega una cartella che usi spesso: i suoi documenti e le sue immagini appariranno qui.',
  homeFolderLink: 'Aggiungi cartella',
  homeFolderRelink: 'Ricollega',
  homeFolderRelinkNamed: 'Ricollega {name}',
  homeFolderOk: 'Collegata',
  homeFolderLostRevoked: "L'autorizzazione per questa cartella è andata persa. Ricollegala.",
  homeFolderLostMissing:
    "Questa cartella non si trova. Se l'hai spostata o eliminata, ricollegala.",
  homeFolderLost: 'Impossibile accedere alla cartella. Collegala di nuovo.',
  homeFolderMenu: 'Menu di {name}',
  homeFolderRemove: 'Rimuovi',
  homeFolderRemoveTitle: 'Rimuovere la cartella «{name}»?',
  homeFolderRemoveBody:
    'Verranno rimosse anche le {count} voci recenti e preferite dei file di questa cartella. I file restano dove sono.',
  homeFolderRemoved: 'Cartella rimossa.',
  homeFolderBack: 'Cartella superiore',
  homeFolderPath: 'Cartella attuale',
  homeFolderSubfolder: 'Cartella',
  homeFolderInsideEmpty: 'In questa cartella non ci sono documenti o immagini da aprire.',
} as const satisfies Record<keyof typeof zh, string>
