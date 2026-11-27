import type { zh } from './zh'

export const it = {
  homeTabNav: 'Menu iniziale',
  homeTabRecent: 'Recenti',
  homeTabFolders: 'Cartelle',
  homeTabTools: 'Strumenti',
  homeTabSettings: 'Impostazioni',
  homeListAll: 'Tutti',
  homeListFavorites: 'Preferiti',
  homeListChips: "Filtra l'elenco",
  homeListFamilyHwp: 'HWP',
  homeListFamilyMd: 'Markdown',
  homeListFavoritesEmpty:
    'Nessun preferito per ora. Usa il menu [⋯] di un file per aggiungerlo ai preferiti.',
  homeListGroupEmpty: 'Nessun file in questo gruppo per ora.',
  homeListFavoriteLost:
    'Impossibile aprire questo file. Potrebbe essere stato spostato o eliminato.',
  homeEmptyText:
    'Non hai ancora aperto nessun documento. Prova il documento di esempio o apri un file.',
  homeEmptySample: 'Apri il documento di esempio',
  homeEmptyCreate: 'Crea nuovo',
  homeCreateFab: 'Crea nuovo',
  homeCreateTitle: 'Crea nuovo',
  homeCreateClose: 'Chiudi',
  homeCreatePdfTools: 'Strumenti PDF',
  homeCreateLocation: 'Crea in: {name}',
  homeCreateAddFolder: 'Aggiungi cartella',
  homeListSortLabel: 'Ordina',
  homeListSortDate: 'Modificato',
  homeListSortName: 'Nome',
  homeListSortDesc: 'Decrescente',
  homeListSortAsc: 'Crescente',
  homeListViewList: 'Vista elenco',
  homeListViewGrid: 'Vista schede',
} as const satisfies Record<keyof typeof zh, string>
