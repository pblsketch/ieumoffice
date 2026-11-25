import type { zh } from './zh'

export const nl = {
  homeSetEditorsTitle: 'Editors',
  homeSetEditorsHint:
    'Uitgeschakelde editors verdwijnen uit de lijst met nieuwe documenten. Staan ze allemaal uit, dan gelden ze allemaal als aan.',
  homeSetEditorHwp: 'HWP',
  homeSetEditorMarkdown: 'Markdown',
  homeSetEditorPdfTools: 'PDF-hulpmiddelen',
  homeSetCardsTitle: 'Nieuwe documenten op het startscherm',
  homeSetCardShow: '{name} tonen op het startscherm',
  homeSetCardUp: '{name} omhoog',
  homeSetCardDown: '{name} omlaag',
  homeSetKeepScreenOn: 'Scherm aan houden tijdens het lezen',
  homeSetKeepScreenOnDesc:
    'Het scherm blijft aan terwijl je een pdf of epub leest of een PPT presenteert.',
  homeSetFoldersTitle: 'Documentmappen',
  homeSetFoldersEmpty:
    'Nog geen mappen gekoppeld. Koppel een map om de bestanden meteen op het tabblad Mappen te zien.',
  homeSetFolderLink: 'Map koppelen',
  homeSetFolderRelink: 'Opnieuw koppelen',
  homeSetFolderRemove: 'Verwijderen',
  homeSetFolderRemoveNamed: '{name} verwijderen',
  homeSetFolderOk: 'Gekoppeld',
  homeSetFolderLost:
    'Deze map is niet bereikbaar. Heb je hem verplaatst of verwijderd, koppel hem dan opnieuw.',
  homeSetFolderRemoveTitle: 'Map ‘{name}’ verwijderen?',
  homeSetFolderRemoveBody:
    'De {count} items bij recent en favorieten voor bestanden in deze map worden ook verwijderd. De bestanden zelf blijven staan.',
  homeSetBackupsTotal: 'Totaal {size}',
  homeSetStorageTitle: 'Opslag',
  homeSetStorageRecovery: 'Herstelkopieën',
  homeSetStorageTemp: 'Tijdelijke bestanden',
  homeSetStorageBackups: 'Originele HWP-back-ups',
  homeSetStorageClearTemp: 'Tijdelijke bestanden wissen',
  homeSetStorageClearRecovery: 'Alle herstelkopieën wissen',
  homeSetStorageClearTempTitle: 'Tijdelijke bestanden wissen?',
  homeSetStorageClearTempBody:
    'Hiermee worden bestanden gewist die even zijn gemaakt bij delen of ontvangen. Je documenten blijven zoals ze zijn.',
  homeSetStorageClearRecoveryTitle: 'Alle herstelkopieën wissen?',
  homeSetStorageClearRecoveryBody:
    'Niet-opgeslagen wijzigingen gaan verloren. De herstelkopie van het document dat nu open is, blijft bewaard.',
  homeSetStorageClearAction: 'Wissen',
  homeSetStorageCleared: '{size} vrijgemaakt.',
  homeSetFailed: 'Dat is niet gelukt. Probeer het zo opnieuw.',
} as const satisfies Record<keyof typeof zh, string>
