import type { zh } from './zh'

export const pt = {
  staleDialogTitle: 'Itens precisam ser atualizados',
  staleDialogBody:
    'Os itens a seguir podem estar desatualizados após as edições recentes. Atualizar antes de continuar?',
  staleActionSave: 'Salvar',
  staleActionPrint: 'Imprimir',
  staleActionPdf: 'Exportar PDF',
  staleActionSubmission: 'Salvar cópia de entrega',
  staleBtnRefreshAll: 'Atualizar tudo',
  staleBtnContinue: 'Continuar assim mesmo',
  staleBtnCancel: 'Cancelar',
  staleReasonPagesChanged: 'Números de página alterados',
  staleReasonEntriesChanged: 'Entradas alteradas',
  staleKindTocBody: 'Sumário',
  staleKindTocTable: 'Lista de tabelas',
  staleKindTocFigure: 'Lista de figuras',
  staleKindTocEquation: 'Lista de equações',
  staleKindIndex: 'Índice remissivo',
  staleKindBibliography: 'Referências',
  staleManualConfirmTitle: 'Edições manuais detectadas',
  staleManualConfirmBody:
    'Foram encontradas edições manuais em: {items}. Sobrescrever e atualizar?',
  staleManualOverwrite: 'Sobrescrever e atualizar',
  staleManualSkip: 'Ignorar',
  staleRefreshDone: '{count} itens atualizados.',
  staleRefreshFailed: 'Não foi possível atualizar alguns itens: {error}',
  staleRefreshBlockedObjects:
    'Atualização ignorada porque o intervalo do sumário ou índice contém objetos do usuário, como notas de rodapé, imagens ou tabelas.',
  submissionMenuLabel: 'Salvar como cópia de entrega…',
  submissionMenuDesc:
    'Salva uma cópia limpa separada sem marcas de índice, citação ou configuração.',
  submissionSaving: 'Criando cópia de entrega…',
  submissionSaved: 'Cópia de entrega salva: {name}',
  submissionBackupKept: 'Foi mantida uma cópia de segurança do arquivo anterior: {name}',
  submissionSavedTailsLost:
    'Cópia de entrega salva ({name}). Algumas páginas mestras ou comentários podem não ter sido mantidos.',
  submissionFailedProtected:
    'Documentos protegidos por senha não podem ser salvos como cópia de entrega.',
  submissionFailedTracked:
    'Documentos com controle de alterações não podem ser salvos como cópia de entrega.',
  submissionFailedSameAsOpen:
    'Não é possível sobrescrever um documento aberto com uma cópia de entrega. Escolha outro nome de arquivo.',
  submissionFailedStrip:
    'A cópia de entrega não foi salva porque algumas marcas internas não puderam ser removidas: {marks}',
  submissionFailedVerify:
    'Falha na verificação da cópia de entrega ({before} → {after} páginas). Tente salvar no formato HWPX.',
  submissionFailedExport: 'Não foi possível gerar a cópia de entrega: {error}',
  submissionFailedWrite: 'Não foi possível salvar a cópia de entrega: {error}',
} satisfies Record<keyof typeof zh, string>
