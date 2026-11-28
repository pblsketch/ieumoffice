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
  homeRunWelcomeTitle: 'Boas-vindas',
  homeRunWelcomeBody:
    'Abra e edite documentos HWP, PDF, Markdown e outros com o GenOffice. Sem conta, sem anúncios, e seus documentos ficam neste aparelho.',
  homeRunStart: 'Começar',
  homeRunTipEditButton: 'Para alterar, toque em [Editar]',
  homeRunTipFlowView: 'Para ajustar o texto à tela, toque em [Modo de leitura]',
  homeRunTipFirstEdit:
    'Uma cópia de recuperação é criada automaticamente. O original é salvo quando você toca em [Concluir]',
  homeRunTipFirstKeyboard: 'Mude o formato do texto com [Aa]',
} as const satisfies Record<keyof typeof zh, string>
