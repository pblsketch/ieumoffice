import type { zh } from './zh'

export const pt = {
  pdfEditPen: 'Caneta',
  pdfEditHighlighter: 'Marca-texto',
  pdfEditTextBox: 'Caixa de texto',
  pdfEditSign: 'Assinar',
  pdfEditPages: 'Organizar páginas',
  pdfEditLink: 'Inserir link',
  pdfEditSaveFailed:
    'Não foi possível salvar. Suas alterações foram mantidas e o arquivo não foi alterado.',
  pdfEditSaveSkipped: 'Algumas edições de texto na página {pages} não puderam ser salvas.',
  pdfEditShareFailed: 'Não foi possível compartilhar.',
  pdfEditReloadFailed:
    'Salvo, mas não foi possível recarregar o documento. Abra o arquivo novamente.',
  pdfEditSignatureUnavailable: 'A assinatura ainda não está disponível.',
  pdfEditSaveAsHint:
    'Escolha como realces, notas e desenhos são tratados na cópia. “Gravar nas páginas” também grava os campos de formulário; “Omitir anotações” mantém links e campos.',
  pdfEditKeepAnnots: 'Manter anotações (editáveis em outros aplicativos)',
  pdfEditFlattenAnnots: 'Gravar nas páginas (visível em todos os aplicativos)',
  pdfEditStripAnnots: 'Omitir anotações (links e campos permanecem)',
  pdfEditSaveVerifyFailed:
    'As alterações na página {pages} não puderam ser gravadas integralmente; o salvamento foi cancelado e o arquivo permaneceu intacto. Desfaça a edição afetada e tente novamente',
} as const satisfies Record<keyof typeof zh, string>
