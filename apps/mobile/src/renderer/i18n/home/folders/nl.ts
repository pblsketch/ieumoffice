import type { zh } from './zh'

export const nl = {
  homeFolderListLabel: 'Gekoppelde mappen',
  homeFolderEmptyTitle: 'Nog geen mappen gekoppeld',
  homeFolderEmptyBody:
    'Koppel een map die je vaak gebruikt, dan staan de documenten en afbeeldingen daaruit meteen hier.',
  homeFolderLink: 'Map toevoegen',
  homeFolderRelink: 'Opnieuw koppelen',
  homeFolderRelinkNamed: '{name} opnieuw koppelen',
  homeFolderOk: 'Gekoppeld',
  homeFolderLostRevoked: 'De toestemming voor deze map is verlopen. Koppel hem opnieuw.',
  homeFolderLostMissing:
    'Deze map is niet gevonden. Heb je hem verplaatst of verwijderd, koppel hem dan opnieuw.',
  homeFolderLost: 'De map is niet bereikbaar. Koppel de map opnieuw.',
  homeFolderMenu: 'Menu voor {name}',
  homeFolderRemove: 'Verwijderen',
  homeFolderRemoveTitle: 'Map ‘{name}’ verwijderen?',
  homeFolderRemoveBody:
    'De {count} items bij recent en favorieten voor bestanden in deze map worden ook verwijderd. De bestanden zelf blijven staan.',
  homeFolderRemoved: 'Map verwijderd.',
  homeFolderBack: 'Map hoger',
  homeFolderPath: 'Huidige map',
  homeFolderSubfolder: 'Map',
  homeFolderInsideEmpty: 'Deze map bevat geen documenten of afbeeldingen om te openen.',
} as const satisfies Record<keyof typeof zh, string>
