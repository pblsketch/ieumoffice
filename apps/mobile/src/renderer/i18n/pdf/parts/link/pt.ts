import type { zh } from './zh'

export const pt = {
  pdfLinkPlaceHint: 'Arraste uma caixa na página onde a ligação vai ficar',
  pdfLinkEditTitle: 'Editar ligação',
  pdfLinkUrlLabel: 'Endereço web (http, https, mailto)',
  pdfLinkPageLabel: 'Ou uma página neste documento (1–{count})',
  pdfLinkUrlInvalid: 'Só é possível ligar endereços http, https e mailto',
  pdfLinkPageInvalid: 'Introduza um número de página de 1 a {count}',
  pdfLinkNeedTarget: 'Introduza um endereço web ou um número de página',
  pdfLinkApply: 'Adicionar ligação',
  pdfLinkDelete: 'Eliminar ligação',
  pdfLinkPending: 'Ligação a adicionar: {target}',
  pdfLinkToPage: 'Página {page}',
  pdfLinkFailed: 'Não foi possível alterar a ligação. Tente novamente quando a gravação terminar.',
  pdfLinkUpdate: 'Aplicar',
} as const satisfies Record<keyof typeof zh, string>
