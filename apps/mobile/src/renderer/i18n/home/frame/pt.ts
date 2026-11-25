import type { zh } from './zh'

export const pt = {
  homeTabNav: 'Menu inicial',
  homeTabRecent: 'Recentes',
  homeTabFolders: 'Pastas',
  homeTabTools: 'Ferramentas',
  homeTabSettings: 'Configurações',
  homeListAll: 'Todos',
  homeListFavorites: 'Favoritos',
  homeListChips: 'Filtrar a lista',
  homeListFamilyHwp: 'HWP',
  homeListFamilyMd: 'Markdown',
  homeListFavoritesEmpty:
    'Ainda não há favoritos. Use o [⋯] de um arquivo para adicioná-lo aos favoritos.',
  homeListGroupEmpty: 'Ainda não há arquivos neste grupo.',
  homeListFavoriteLost:
    'Não foi possível abrir este arquivo. Ele pode ter sido movido ou excluído.',
  homeEmptyText:
    'Você ainda não abriu nenhum documento. Experimente o documento de exemplo ou abra um arquivo.',
  homeEmptySample: 'Abrir o documento de exemplo',
  homeEmptyCreate: 'Criar novo',
  homeCreateFab: 'Criar novo',
  homeCreateTitle: 'Criar novo',
  homeCreateClose: 'Fechar',
  homeCreatePdfTools: 'Ferramentas PDF',
} as const satisfies Record<keyof typeof zh, string>
