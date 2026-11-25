import type { zh } from './zh'

export const pt = {
  homeSetEditorsTitle: 'Editores',
  homeSetEditorsHint:
    'Os editores desligados saem da lista de novos documentos. Desligar todos equivale a deixar todos ligados.',
  homeSetEditorHwp: 'HWP',
  homeSetEditorMarkdown: 'Markdown',
  homeSetEditorPdfTools: 'Ferramentas PDF',
  homeSetCardsTitle: 'Novos documentos na tela inicial',
  homeSetCardShow: 'Mostrar {name} na tela inicial',
  homeSetCardUp: 'Mover {name} para cima',
  homeSetCardDown: 'Mover {name} para baixo',
  homeSetKeepScreenOn: 'Manter a tela ligada durante a leitura',
  homeSetKeepScreenOnDesc:
    'A tela não se apaga enquanto você lê um PDF ou EPUB ou apresenta um PPT.',
  homeSetFoldersTitle: 'Pastas de documentos',
  homeSetFoldersEmpty:
    'Nenhuma pasta vinculada ainda. Vincule uma pasta para ver os arquivos direto na aba Pastas.',
  homeSetFolderLink: 'Vincular pasta',
  homeSetFolderRelink: 'Vincular de novo',
  homeSetFolderRemove: 'Remover',
  homeSetFolderRemoveNamed: 'Remover {name}',
  homeSetFolderOk: 'Vinculada',
  homeSetFolderLost:
    'Não é possível acessar esta pasta. Se você a moveu ou excluiu, vincule de novo.',
  homeSetFolderRemoveTitle: 'Remover a pasta "{name}"?',
  homeSetFolderRemoveBody:
    'As {count} entradas de recentes e favoritos dos arquivos desta pasta também serão removidas. Os arquivos em si continuam lá.',
  homeSetBackupsTotal: 'Total {size}',
  homeSetStorageTitle: 'Armazenamento',
  homeSetStorageRecovery: 'Cópias de recuperação',
  homeSetStorageTemp: 'Arquivos temporários',
  homeSetStorageBackups: 'Backups originais de HWP',
  homeSetStorageClearTemp: 'Limpar arquivos temporários',
  homeSetStorageClearRecovery: 'Limpar todas as cópias de recuperação',
  homeSetStorageClearTempTitle: 'Limpar os arquivos temporários?',
  homeSetStorageClearTempBody:
    'Isso apaga arquivos criados por pouco tempo ao compartilhar ou receber. Seus documentos não mudam.',
  homeSetStorageClearRecoveryTitle: 'Limpar todas as cópias de recuperação?',
  homeSetStorageClearRecoveryBody:
    'As alterações não salvas serão perdidas. A cópia de recuperação do documento aberto agora é mantida.',
  homeSetStorageClearAction: 'Limpar',
  homeSetStorageCleared: '{size} liberados.',
  homeSetFailed: 'Não foi possível concluir. Tente de novo daqui a pouco.',
} as const satisfies Record<keyof typeof zh, string>
