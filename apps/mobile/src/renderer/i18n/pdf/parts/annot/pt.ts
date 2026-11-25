import type { zh } from './zh'

export const pt = {
  pdfAnnotHighlight: 'Destacar',
  pdfAnnotUnderline: 'Sublinhar',
  pdfAnnotSquiggly: 'Ondulado',
  pdfAnnotStrikeout: 'Tachar',
  pdfAnnotModeSelect: 'Selecionar texto',
  pdfAnnotModeNote: 'Colocar nota',
  pdfAnnotHintSelect:
    'Arraste na horizontal sobre o texto, ou toque e segure e depois arraste, para selecionar. Toque numa marcação para mudar a cor ou removê-la.',
  pdfAnnotHintNote: 'Toque onde a nota deve ficar.',
  pdfAnnotPen: 'Marca-texto {n}',
  pdfAnnotColor: 'Cor {n}',
  pdfAnnotRemove: 'Remover marcação',
  pdfAnnotMarkupTitle: 'Cor da marcação',
  pdfAnnotClearSelection: 'Limpar seleção',
  pdfAnnotNoText: 'Esta página não tem texto selecionável.',
  pdfAnnotOpenNote: 'Abrir nota',
  pdfAnnotFailed: 'Não foi possível alterar a anotação.',
  pdfAnnotNewNote: 'Nova nota',
  pdfAnnotReplyPlaceholder: 'Escreva uma resposta',
} as const satisfies Record<keyof typeof zh, string>
