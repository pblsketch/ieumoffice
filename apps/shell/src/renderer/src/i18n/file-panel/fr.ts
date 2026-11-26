import type { zh } from './zh'

export const fr = {
  panelTitle: 'Fichiers',
  showPanel: 'Afficher le panneau Fichiers',
  hidePanel: 'Masquer le panneau Fichiers',
  searchPlaceholder: 'Rechercher un fichier',
  sectionCurrent: 'Dossier de ce document',
  sectionFolders: 'Dossiers',
  sectionRecent: 'Récents',
  addFolder: 'Ajouter un dossier',
  refresh: 'Actualiser',
  collapseAll: 'Tout réduire',
  emptyFolder: 'Aucun document à ouvrir ici',
  folderMissing: 'Dossier introuvable',
  untitledHint:
    "Ce document n'est pas encore enregistré. Son dossier apparaîtra ici une fois enregistré.",
  noResults: 'Aucun fichier correspondant',
  openMark: 'Ouvert',
  resizePanel: 'Redimensionner le panneau Fichiers',
  noRecent: 'Aucun document récent',
  searching: 'Recherche…',
} satisfies Record<keyof typeof zh, string>
