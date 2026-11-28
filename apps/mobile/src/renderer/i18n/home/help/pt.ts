import type { zh } from './zh'

export const pt = {
  homeHelpSection: 'Ajuda',
  homeHelpClose: 'Fechar',
  homeHelpReplay: 'Ver o guia de boas-vindas de novo',
  homeHelpReplayFailed:
    'Não foi possível reativar o guia de boas-vindas. Tente de novo daqui a pouco.',
  homeHelpFeedback: 'Enviar comentários',
  homeHelpWhatsNew: 'Novidades desta versão',

  homeHelpOpenTitle: 'Abrir documentos',
  homeHelpOpenBody1:
    'Na aba “Recentes”, toque em “Abrir arquivo” para escolher um documento deste dispositivo ou de outro app de armazenamento.',
  homeHelpOpenBody2:
    'Vincule uma pasta que você usa com frequência, e os documentos dela aparecem na hora na aba “Pastas”.',
  homeHelpOpenBody3:
    'Os documentos que você abre ficam na aba “Recentes”. Marque um com estrela para encontrá-lo também em “Favoritos”.',
  homeHelpOpenBody4:
    'O documento abre primeiro para leitura. Quando quiser alterá-lo, toque em [Editar].',

  homeHelpEditTitle: 'Editar e salvar',
  homeHelpEditBody1:
    'No modo de leitura, toque em [Editar] no topo para começar a fazer alterações.',
  homeHelpEditBody2:
    'Toque no texto para abrir o teclado. A barra acima dele tem formatações como negrito e listas.',
  homeHelpEditBody3:
    'Quando terminar, toque em [Concluir]. O arquivo original é salvo e você volta ao modo de leitura.',
  homeHelpEditBody4:
    'Se não for possível gravar no arquivo original, use “Salvar como” para criar um arquivo novo.',

  homeHelpRecoveryTitle: 'Salvamento e cópias de recuperação',
  homeHelpRecoveryBody1:
    'Enquanto você edita, o app guarda uma cópia de recuperação sozinho. Não é preciso tocar em nada.',
  homeHelpRecoveryBody2: 'O arquivo original é gravado quando você toca em [Concluir].',
  homeHelpRecoveryBody3:
    'Se o app fechar antes de você salvar, na próxima vez aparece um aviso sobre a cópia de recuperação no topo da aba “Recentes”. Restaure por ali.',
  homeHelpRecoveryBody4:
    'Em Configurações > Armazenamento, você vê quanto espaço as cópias de recuperação ocupam e pode apagá-las.',

  homeHelpShareTitle: 'Compartilhar e receber',
  homeHelpShareBody1:
    'Ao ver um documento, toque em [Compartilhar] para enviar o original como está ou em outro formato, como PDF.',
  homeHelpShareBody2:
    'Em uma lista da tela inicial, escolha [⋯] > Compartilhar para enviar o arquivo original. Toque e segure para selecionar vários arquivos e enviá-los juntos.',
  homeHelpShareBody3:
    'Um arquivo enviado de outro app abre somente para leitura. Para alterá-lo, toque em [Editar uma cópia]. O original continua como estava.',

  homeHelpFlowTitle: 'Modo de leitura para HWP',
  homeHelpFlowBody1:
    'Os documentos HWP abrem na visualização de página, como seriam impressos. Para ajustar o texto à largura da tela, toque em [Modo de leitura] nas ferramentas de exibição.',
  homeHelpFlowBody2:
    'Para voltar ao layout de página impressa, toque em [Visualização de página] nas ferramentas de exibição.',
  homeHelpFlowBody3:
    'O modo de leitura muda apenas a forma de exibir o documento. As páginas e o arquivo salvo continuam iguais.',

  homeHelpAiTitle: 'Ligar e desligar a IA',
  homeHelpAiBody1: 'A IA vem desligada. Enquanto estiver desligada, nenhum botão de IA aparece.',
  homeHelpAiBody2:
    'Para usá-la, ligue a IA em Configurações e depois adicione uma chave de API ou escolha uma conexão gratuita em “Conexões de IA”. Você não precisa de conta neste app.',
  homeHelpAiBody3:
    'O conteúdo só vai para o serviço de IA escolhido quando você pede algo à IA. Desligue a IA de novo e todos os botões de IA desaparecem.',

  homeHelpFeedbackTitle: 'Enviar comentários',
  homeHelpFeedbackBody:
    'A pesquisa abre no navegador. Os dados abaixo são copiados para a área de transferência para você colá-los na pesquisa. O aplicativo não envia nada por conta própria, e o conteúdo dos documentos nunca é incluído.',
  homeHelpFeedbackDetails: 'Versão {version}\nSistema {os}\nIdioma {language}',
  homeHelpFeedbackOpen: 'Abrir pesquisa',
  homeHelpFeedbackCancel: 'Cancelar',
  homeHelpFeedbackCopyFailed:
    'Não foi possível copiar para a área de transferência. Toque e segure o texto abaixo para copiá-lo e depois cole na pesquisa.',
  homeHelpFeedbackOpenFailed: 'Não foi possível abrir o navegador.',

  homeHelpWhatsNewVersion: 'Versão {version}',
  homeHelpWhatsNewEmpty: 'Não há notas para esta versão.',
  homeHelpNew010First: 'A primeira versão do app GenOffice para celular.',
  homeHelpNew010Edit: 'Abra e edite documentos HWP, PDF, Markdown, HTML e planilhas.',
  homeHelpNew010Read: 'Leia livros EPUB e apresentações PPT.',
  homeHelpNew010PdfTools:
    'Ferramentas de PDF: organizar páginas, converter, reduzir o tamanho e proteger, remover anotações.',
  homeHelpNew010Ai:
    'Um assistente de IA, desligado no início, que funciona com uma chave de API ou uma conexão gratuita.',
  homeHelpNew010Mobile:
    'Compartilhar e receber arquivos, modo de leitura para HWP, guia de boas-vindas, gerenciamento de armazenamento e tela ligada durante a leitura.',
} as const satisfies Record<keyof typeof zh, string>
