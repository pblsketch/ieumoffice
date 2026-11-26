import type { zh } from './zh'

export const pt = {
  pdfTextHint: 'Toque num espaço vazio para adicionar texto ou toque num texto para editá-lo.',
  pdfTextInputLabel: 'Texto a adicionar',
  pdfTextEditLabel: 'Texto a editar',
  pdfTextStyleBar: 'Estilo do texto',
  pdfTextBold: 'Negrito',
  pdfTextSize: 'Tamanho do texto',
  pdfTextSizeDown: 'Diminuir texto',
  pdfTextSizeUp: 'Aumentar texto',
  pdfTextColor: 'Cor do texto',
  pdfTextColorDocument: 'Manter a cor do documento',
  pdfTextFont: 'Fonte',
  pdfTextFontDocument: 'Fonte do documento',
  pdfTextBack: 'Voltar',
  pdfTextDelete: 'Excluir',
  pdfTextDone: 'Concluir',
  pdfTextCannotDraw: 'Estes caracteres não podem ser adicionados: {chars}',
  pdfTextFontSubstituted: 'Estes caracteres usarão outra fonte: {chars}',
  pdfTextScannedPage: 'Esta página não tem texto. Você só pode adicionar texto novo.',
  pdfTextNoMatch: 'Este texto não pode ser editado: não foi encontrado no documento.',
  pdfTextOverflow: 'O texto editado sobreporia o texto abaixo. Encurte-o.',
} as const satisfies Record<keyof typeof zh, string>
