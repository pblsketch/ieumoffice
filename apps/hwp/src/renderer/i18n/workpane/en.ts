import type { zh } from './zh'

export const en = {
  workpaneTitle: 'Workpane',
  workpaneOpen: 'Workpane',
  workpaneClose: 'Close workpane',
  workpaneExpand: 'Expand workpane',
  workpaneResize: 'Resize workpane',
  workpaneTabOutline: 'Outline',
  workpaneTabFind: 'Find',
  workpaneTabBibliography: 'References',
  workpaneMenuOutline: 'Workpane › Outline',
  workpaneMenuFind: 'Workpane › Find',
  workpaneMenuBibliography: 'Workpane › References',
  workpaneOutlineEmpty: 'Document headings will appear here.',
  workpaneFindEmpty: 'Search and jump to matches in this document.',
  workpaneBibliographyEmpty: 'Manage references and insert citations here.',
  workpaneRailHint: 'Window is narrow; click a tab icon to view.',
} satisfies Record<keyof typeof zh, string>
