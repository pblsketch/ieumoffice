import type { zh } from './zh'

export const pt = {
  panelTitle: 'Arquivos',
  showPanel: 'Mostrar painel de arquivos',
  hidePanel: 'Ocultar painel de arquivos',
  searchPlaceholder: 'Procurar um arquivo',
  sectionCurrent: 'Pasta deste documento',
  sectionFolders: 'Pastas',
  sectionRecent: 'Recentes',
  addFolder: 'Adicionar pasta',
  refresh: 'Atualizar',
  collapseAll: 'Recolher tudo',
  emptyFolder: 'Não há documentos para abrir aqui',
  folderMissing: 'Pasta não encontrada',
  untitledHint:
    'Este documento ainda não foi salvo. A pasta dele aparece aqui depois que você salvar.',
  noResults: 'Nenhum arquivo correspondente',
  openMark: 'Aberto',
  resizePanel: 'Redimensionar o painel de arquivos',
  noRecent: 'Nenhum documento recente',
  searching: 'Procurando…',
  quickLook: 'Visualização Rápida',
} satisfies Record<keyof typeof zh, string>
