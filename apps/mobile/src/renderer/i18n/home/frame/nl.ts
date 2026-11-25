import type { zh } from './zh'

export const nl = {
  homeTabNav: 'Startmenu',
  homeTabRecent: 'Recent',
  homeTabFolders: 'Mappen',
  homeTabTools: 'Hulpmiddelen',
  homeTabSettings: 'Instellingen',
  homeListAll: 'Alles',
  homeListFavorites: 'Favorieten',
  homeListChips: 'Lijst filteren',
  homeListFamilyHwp: 'HWP',
  homeListFamilyMd: 'Markdown',
  homeListFavoritesEmpty: 'Nog geen favorieten. Voeg een bestand toe via zijn menu [⋯].',
  homeListGroupEmpty: 'Nog geen bestanden in deze groep.',
  homeListFavoriteLost:
    'Dit bestand kan niet worden geopend. Het is misschien verplaatst of verwijderd.',
  homeEmptyText:
    'Je hebt nog geen documenten geopend. Bekijk het voorbeelddocument of open een bestand.',
  homeEmptySample: 'Voorbeelddocument openen',
  homeEmptyCreate: 'Nieuw maken',
  homeCreateFab: 'Nieuw maken',
  homeCreateTitle: 'Nieuw maken',
  homeCreateClose: 'Sluiten',
  homeCreatePdfTools: 'PDF-hulpmiddelen',
} as const satisfies Record<keyof typeof zh, string>
