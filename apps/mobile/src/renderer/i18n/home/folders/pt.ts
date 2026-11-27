import type { zh } from './zh'

export const pt = {
  homeFolderListLabel: 'Pastas vinculadas',
  homeFolderEmptyTitle: 'Nenhuma pasta vinculada ainda',
  homeFolderEmptyBody:
    'Vincule uma pasta que você usa com frequência e os documentos e imagens dela aparecem aqui.',
  homeFolderLink: 'Adicionar pasta',
  homeFolderRelink: 'Vincular de novo',
  homeFolderRelinkNamed: 'Vincular {name} de novo',
  homeFolderOk: 'Vinculada',
  homeFolderLostRevoked: 'A permissão para esta pasta foi perdida. Vincule de novo.',
  homeFolderLostMissing:
    'Esta pasta não foi encontrada. Se você a moveu ou excluiu, vincule de novo.',
  homeFolderLost: 'Não é possível acessar a pasta. Vincule-a novamente.',
  homeFolderMenu: 'Menu de {name}',
  homeFolderRemove: 'Remover',
  homeFolderRemoveTitle: 'Remover a pasta "{name}"?',
  homeFolderRemoveBody:
    'As {count} entradas de recentes e favoritos dos arquivos desta pasta também serão removidas. Os arquivos em si continuam lá.',
  homeFolderRemoved: 'Pasta removida.',
  homeFolderBack: 'Pasta acima',
  homeFolderPath: 'Pasta atual',
  homeFolderSubfolder: 'Pasta',
  homeFolderInsideEmpty: 'Esta pasta não tem documentos nem imagens para abrir.',
} as const satisfies Record<keyof typeof zh, string>
