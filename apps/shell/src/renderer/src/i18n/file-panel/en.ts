import type { zh } from './zh'

export const en = {
  panelTitle: 'Files',
  showPanel: 'Show Files Panel',
  hidePanel: 'Hide Files Panel',
  searchPlaceholder: 'Find a file',
  sectionCurrent: "This document's folder",
  sectionFolders: 'Folders',
  sectionRecent: 'Recent',
  addFolder: 'Add folder',
  refresh: 'Refresh',
  collapseAll: 'Collapse all',
  emptyFolder: 'No documents to open here',
  folderMissing: 'Folder not found',
  untitledHint: 'This document is not saved yet. Its folder appears here once you save it.',
  noResults: 'No matching files',
  openMark: 'Open',
  resizePanel: 'Resize files panel',
  noRecent: 'No recent documents',
  searching: 'Searching…',
  quickLook: 'Quick Look',
} satisfies Record<keyof typeof zh, string>
