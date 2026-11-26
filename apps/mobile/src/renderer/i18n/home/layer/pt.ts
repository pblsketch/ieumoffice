import type { zh } from './zh'

export const pt = {
  homeRunEditorOffTitle: 'O editor {name} está desativado',
  homeRunEditorOffBody:
    'Ative-o para abrir este arquivo. Você pode desativá-lo de novo nas Configurações.',
  homeRunEditorOffConfirm: 'Ativar e abrir',
  homeRunStripSample: 'Documento de exemplo · Somente leitura',
  homeRunStripReceived: 'Arquivo recebido · Somente leitura',
  homeRunStripReadOnly: 'Somente leitura',
  homeRunStripCopy: 'Editar uma cópia',
  homeRunStripClose: 'Fechar aviso',
  homeRunReceiveTitle: 'Arquivos recebidos',
  homeRunReceiveCount: '{count} arquivos',
  homeRunReceiveClose: 'Fechar arquivos recebidos',
  homeRunReceiveOpen: 'Abrir',
  homeRunReceivePdfOff: 'As ferramentas de PDF estão desativadas',
  homeRunReceivePdfOn: 'Ativar e continuar',
  homeRunGuideLabel: 'Guia de boas-vindas',
  homeRunStep: 'Etapa {current} de {total}',
  homeRunWelcomeTitle: 'Boas-vindas',
  homeRunWelcomeBody:
    'Abra e edite documentos HWP, PDF, Markdown e outros com o GenOffice. Sem conta, sem anúncios, e seus documentos ficam neste aparelho.',
  homeRunNext: 'Próximo',
  homeRunSkip: 'Pular',
  homeRunFolderTitle: 'Vincular uma pasta de documentos (opcional)',
  homeRunFolderBody:
    'Vincule uma pasta que você usa sempre e os arquivos dela aparecem direto na aba [Pastas].',
  homeRunFolderPick: 'Escolher pasta',
  homeRunLater: 'Depois',
  homeRunFolderLinked: '✓ Pasta de documentos vinculada · Altere nas Configurações',
  homeRunStart: 'Começar',
  homeRunTipEditButton: 'Para alterar, toque em [Editar]',
  homeRunTipFlowView:
    'Mudamos para a visualização contínua para facilitar a leitura · A visualização de página fica aqui',
  homeRunTipFirstEdit:
    'Uma cópia de recuperação é criada automaticamente. O original é salvo quando você toca em [Concluir]',
  homeRunTipFirstKeyboard: 'Mude o formato do texto com [Aa]',
} as const satisfies Record<keyof typeof zh, string>
