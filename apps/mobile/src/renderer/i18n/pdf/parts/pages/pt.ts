import type { zh } from './zh'

export const pt = {
  pdfPagesSelected: '{n} selecionadas',
  pdfPagesNoneSelected: 'Toque nas páginas para selecioná-las',
  pdfPagesSelectAll: 'Selecionar tudo',
  pdfPagesClearSelection: 'Limpar seleção',
  pdfPagesRotate: 'Girar',
  pdfPagesDelete: 'Excluir',
  pdfPagesMoveEarlier: 'Antes',
  pdfPagesMoveLater: 'Depois',
  pdfPagesBlankBefore: 'Página em branco antes',
  pdfPagesBlankAfter: 'Página em branco depois',
  pdfPagesImport: 'De outro PDF',
  pdfPagesPageLabel: 'Página {n}',
  pdfPagesBlankLabel: 'Página em branco',
  pdfPagesDragHandle: 'Arraste para mover',
  pdfPagesKeepOne: 'A última página não pode ser excluída.',
  pdfPagesActionFailed: 'Não foi possível alterar as páginas.',
  pdfPagesDeletedLabel: 'Será excluída',
  pdfPagesDeletedHint: 'Excluída ao salvar. Desfazer a traz de volta.',
  pdfPagesMovedLabel: 'Nova ordem: página {n}',
  pdfPagesImportTitle: 'Inserir páginas de outro PDF',
  pdfPagesImportCount: 'Páginas a inserir: {n}',
  pdfPagesImportPlace: 'Onde inserir',
  pdfPagesImportFront: 'No início',
  pdfPagesImportAfter: 'Depois da página {n}',
  pdfPagesImportEnd: 'No fim',
  pdfPagesImportConfirmHint:
    'Suas alterações até agora são salvas primeiro e depois as páginas são inseridas. As páginas inseridas são gravadas direto no arquivo e não podem ser desfeitas.',
  pdfPagesImportConfirm: 'Salvar e inserir',
  pdfPagesImportDone: '{n} páginas inseridas.',
  pdfPagesImportFailed: 'Não foi possível inserir as páginas.',
  pdfPagesImportDamaged: 'Não é possível inserir páginas de outro PDF em um documento danificado.',
  pdfPagesImportEncrypted:
    'Não é possível inserir páginas de outro PDF em um documento criptografado.',
  pdfPagesImportUntitled:
    'Não é possível inserir páginas em um documento novo que nunca foi salvo. Salve-o primeiro.',
  pdfPagesImportReadOnly: 'Não é possível inserir páginas em um documento somente leitura.',
  pdfPagesImportPickEncrypted:
    'O PDF escolhido é protegido por senha, então suas páginas não podem ser importadas.',
  pdfPagesImportPickUnreadable: 'Não foi possível ler o arquivo escolhido como PDF.',
} as const satisfies Record<keyof typeof zh, string>
