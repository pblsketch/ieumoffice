import type { zh } from './zh'

export const fr = {
  sheetsToolbarFormat: 'Format de cellule',
  sheetsToolbarRows: 'Lignes et colonnes',
  sheetsToolbarSort: 'Trier et filtrer',
  sheetsToolbarInsert: 'Insérer',
  sheetsToolbarInsertValues: 'Dates et feuilles',
  sheetsToolbarToday: 'Date du jour',
  sheetsToolbarTimeNow: 'Heure actuelle',
  sheetsToolbarNewSheet: 'Nouvelle feuille',
  sheetsToolbarFind: 'Rechercher',
  sheetsToolbarViewOnly:
    'Les graphiques, tableaux croisés dynamiques et mises en forme conditionnelles sont ici en lecture seule. Ouvrez le fichier sur un ordinateur pour les modifier.',
  sheetsToolbarFullLoaded: 'Tout le classeur est chargé. Touchez à nouveau trier ou filtrer.',
} as const satisfies Record<keyof typeof zh, string>
