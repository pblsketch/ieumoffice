import type { zh } from './zh'

export const pt = {
  pdfViewEditorName: 'Editor de PDF',
  pdfViewLoading: 'Abrindo…',
  pdfViewOpenFailed:
    'Não foi possível abrir este PDF. O arquivo pode estar danificado ou não ser um PDF.',
  pdfViewCertEncrypted:
    'Este PDF está protegido com um certificado, não com uma senha. Abra-o no aplicativo que o emitiu.',
  pdfViewBlankUnavailable: 'Não foi possível criar um novo PDF.',
  pdfViewPagesFailed: 'Algumas páginas não puderam ser lidas e aparecem em branco.',
  pdfViewPageBroken: 'Não é possível exibir esta página',
  pdfViewPageLabel: 'Página {page}',
  pdfViewPageIndicator: 'Página {page} de {count}',
  pdfViewInternalLink: 'Ir para a página vinculada',
  pdfViewPasswordTitle: 'Este PDF está criptografado',
  pdfViewPasswordBody: '"{name}" está protegido por senha. Digite a senha para abri-lo.',
  pdfViewPasswordLabel: 'Senha',
  pdfViewPasswordPlaceholder: 'Digite a senha para abrir',
  pdfViewPasswordShow: 'Mostrar senha',
  pdfViewPasswordHide: 'Ocultar senha',
  pdfViewPasswordOpen: 'Abrir',
  pdfViewPasswordWrong: 'Senha incorreta, tente novamente',
  pdfViewReadOnlyEncrypted: 'Documento criptografado é somente leitura',
  pdfViewReadOnlyDamaged:
    'Arquivo danificado: páginas ilegíveis aparecem em branco, somente leitura',
  pdfViewReadOnlyNotWritable:
    'Este arquivo não pode ser salvo no local original, por isso é somente leitura',
  pdfViewSearch: 'Pesquisar',
  pdfViewSearchPlaceholder: 'Localizar no documento',
  pdfViewSearching: 'Pesquisando…',
  pdfViewSearchNone: 'Sem resultados',
  pdfViewSearchPrev: 'Anterior',
  pdfViewSearchNext: 'Próximo',
  pdfViewSearchClose: 'Fechar pesquisa',
  pdfViewOutline: 'Estrutura',
  pdfViewOutlineEmpty: 'Este documento não tem estrutura de tópicos',
  pdfViewGoToPage: 'Ir para a página',
  pdfViewGoToPageLabel: 'Número da página (1–{count})',
  pdfViewGoToPageGo: 'Ir',
  pdfViewGoToPageInvalid: 'Digite um número de 1 a {count}',
} as const satisfies Record<keyof typeof zh, string>
