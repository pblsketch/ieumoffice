# Hangul (HWP / HWPX): edição, painel de trabalho e impressão

O GenOffice abre e edita documentos Hangul `.hwp` e `.hwpx` em uma guia, com atalhos de teclado, estilos, tabelas, notas, impressão e um painel de IA. Tudo roda localmente no seu PC.

## Abrir, salvar e imprimir

- Abre arquivos `.hwp` e `.hwpx` a partir da tela Início, **Arquivo > Abrir**, arrastando para a janela ou pelo Google Drive; converte PDFs em novas guias Hangul via **Arquivo > Importar PDF**.
- Salva novamente no formato original do arquivo aberto (`.hwp` continua `.hwp`, `.hwpx` continua `.hwpx`), mantém um backup `.bak` antes da primeira sobrescrita, verifica a releitura de HWP e guarda cópias de salvamento automático e recuperação após falhas.
- Imprimir (Ctrl+P) oferece visualização ao vivo, exportação em PDF e opções de layout de impressão com várias páginas.

## Painel de trabalho esquerdo: Estrutura, Localizar e Referências

- Abra o painel de trabalho esquerdo pelo botão na barra superior, em **Exibir > Painel de trabalho** (Estrutura / Localizar / Referências), ou pressione **Ctrl+F** para ir direto à guia Localizar. O Localizar tradicional (**Ctrl+Q,F**) e o Localizar e substituir (**Ctrl+H**) continuam disponíveis.
- **Guia Estrutura**: lista os títulos de estrutura nativos do Hangul e os títulos mapeados por estilo (padrão `제목 N` / `Heading N`, personalizável por documento ou em todo o aplicativo na gaveta de configurações da Estrutura). Filtre por nível (`1`, `2`, `3`, ... Todos), recolha ramos, clique para saltar, promova ou rebaixe títulos (com subtítulos por padrão, ou segure **Shift** para um único título) e arraste títulos para reordenar seções inteiras em uma única etapa de desfazer.
- **Guia Localizar**: pesquisa no corpo do texto, tabelas (incluindo tabelas aninhadas), caixas de texto, notas de rodapé e notas de fim (excluindo cabeçalhos e rodapés), com filtros de maiúsculas/minúsculas, palavra inteira, expressões regulares, estilo de parágrafo e formatação de caracteres. Clique em um resultado para saltar e selecioná-lo, ou substitua uma, as selecionadas ou todas as ocorrências em uma única etapa de desfazer (ignorando objetos embutidos e marcas de citação com contagem).
- O painel de trabalho lembra seu estado aberto, guia ativa e largura, recolhe-se em uma barra de ícones em janelas estreitas e oculta-se no modo de apresentação e na visualização de impressão. Todos os recursos do painel funcionam sem IA.

## Notas, atalhos e painel de IA

- Abra a coluna de notas pela barra superior ou em **Inserir > Nota** para ler, adicionar, editar e excluir notas em texto simples ao lado do documento.
- Suporta atalhos de edição para documentos Hangul, marcadores de parágrafo na régua horizontal, Copiar formatação (**Alt+C**), conversão de Hanja (**F9** / tecla Hanja) e Informações do documento (**Ctrl+Q,I**).
- O painel de IA opcional e os [comandos de terminal](help://cli) (`ieumoffice hwp read`, `ieumoffice hwp apply`) podem ler e editar texto, estilos, tabelas, equações, layout de página, estrutura e resultados de pesquisa; cada edição de IA equivale a uma única etapa de desfazer.

## Sumário: criar e atualizar

- Use **Ferramentas > Criar sumário** (ou **Ferramentas > Atualizar sumário**, ou clique com o botão direito dentro de um sumário) para inserir um **sumário** do documento a partir dos títulos da Estrutura de tópicos, além de **listas de tabelas**, **figuras** e **equações** obtidas das legendas de objetos e parágrafos de legenda.
- Escolha o layout **Tabulação pontilhada** (padrão) ou **Tabela sem bordas** (2 colunas), defina a profundidade dos títulos (níveis 1–10, padrão 3), personalize o título e inclua opcionalmente links clicáveis (clique ou pressione **Ctrl+clique** em uma linha para ir direto ao título).
- Os números de página refletem a numeração impressa, incluindo reinícios de numeração e formatos romanos ou personalizados.
- A atualização renova itens e números de página no local, avisa antes de sobrescrever linhas editadas manualmente e detecta sumários existentes sem marcação criados em outro programa, pedindo confirmação antes de substituí-los.

## Índice remissivo: marcar entradas e criar

- Use **Ferramentas > Marcar entrada de índice** (ou clique com o botão direito no corpo do texto) para marcar a palavra selecionada ou sob o cursor, adicionar uma subentrada opcional ou marcar **todas as ocorrências** (apenas no corpo do texto; exibe a contagem de ocorrências ignoradas em tabelas, caixas de texto e notas). No mesmo diálogo é possível visualizar e excluir marcações existentes.
- Use **Ferramentas > Criar índice remissivo** para inserir o índice na posição do cursor e **Ferramentas > Atualizar índice remissivo** para atualizá-lo após alterações. O título padrão (“Índice”) pode ser personalizado.
- As entradas são ordenadas em coreano (가나다) → inglês (ABC) → outros, com cabeçalhos opcionais por consoante/letra, 1–3 colunas (padrão 2 colunas, aplicadas somente ao índice sem alterar as colunas do restante do documento) e layout **Tabulação pontilhada** ou **Tabela sem bordas**.

## Aviso de itens desatualizados e cópia de entrega

- Ao salvar manualmente, imprimir, exportar como PDF ou salvar como cópia de entrega, o editor verifica se os sumários ou o índice estão desatualizados e oferece atualizar tudo em uma única etapa de desfazer. Essa verificação nunca é executada durante o salvamento automático e nunca bloqueia o salvamento.
- Use **Arquivo > Salvar como cópia de entrega** para salvar uma cópia limpa separada, sem marcas internas de edição (marcas de índice, marcas de bloco de índice e configurações salvas), mantendo intactos os sumários, âncoras de títulos e links. O arquivo de trabalho original permanece intocado para que você continue atualizando-o depois.

## Referências e citações

- Abra a guia **Referências** no painel de trabalho esquerdo (ou **Ferramentas > Referências**) para gerenciar uma única biblioteca local no seu PC com busca, etiquetas, adicionar/editar/excluir, importação e exportação (`BibTeX`, `RIS`, `CSL JSON`) e importação de linhas de uma lista de referências existente no documento com pré-visualização antes de confirmar.
- Oferece quatro estilos de citação (**APA 7**, **Chicago**, **MLA 9** e **IEEE**; referências em coreano seguem o padrão acadêmico coreano nos quatro estilos). Insira citações entre parênteses, narrativas ou múltiplas com indicação de página e gere ou atualize uma bibliografia com recuo deslocado; trocar de estilo atualiza as citações marcadas e a bibliografia em uma única etapa de desfazer, preservando citações editadas manualmente.
- A auditoria integrada de 6 pontos (ausente na bibliografia, entradas não citadas, ordem de classificação, sufixos a/b ausentes, edições manuais e itens não verificados) permite clicar para ir direto a cada ocorrência, além de avisos de bibliografia ou numeração IEEE desatualizadas antes de salvar manualmente, imprimir ou exportar.
- A busca opcional de referências por IA (quando as ferramentas de internet estão ativadas) sempre adiciona candidatos como **Não verificado** com o URL de origem nas notas; eles não podem ser citados nem incluídos na bibliografia até que você mesmo os revise e marque como **Verificado**.

## Macros: gravação de teclas e scripts

- Use **Ferramentas > Macros** (ou pressione **Alt+Shift+H** para iniciar ou parar a gravação de teclas e **Alt+Shift+X** para parar) para gravar texto digitado, movimentação do cursor, formatação, estilos, tabelas e edições compatíveis diretamente em um script editável. Um indicador de gravação aparece na barra superior durante o registro, e ações não suportadas ou cliques do mouse são avisados imediatamente e listados como ignorados ao parar.
- Abra o **Gerenciador de macros** para organizar macros salvas localmente, atribuir até 11 atalhos (**Alt+1**–**Alt+9**, **Alt+0**, **Alt+-**), editar scripts com indicação de linha e coluna para erros de sintaxe e exportar ou importar arquivos de texto simples `.ieummacro`. Scripts importados são exibidos por completo e precisam ser confirmados e salvos antes da execução; macros incorporadas em arquivos de documento nunca são lidas nem executadas. No macOS, inicie e gerencie macros pelo menu **Ferramentas > Macros**, pois as combinações com a tecla Option digitam caracteres.
- Cada macro roda de forma síncrona em um interpretador restrito com suporte à API de documentos do aplicativo e a objetos de script de macro compatíveis (`HAction`, `HParameterSet`), aplicando limites de tempo, etapas, profundidade de chamada e memória, além de proteção de objetos e notas. Cada execução equivale sempre a um único passo de desfazer e reverte tudo em caso de erro, ação não suportada ou excesso de limite.
- A opção **Escrever com IA** (exibida no editor de macros somente com a IA ativada) permite descrever uma tarefa repetitiva para gerar um rascunho de script; somente sua descrição e a referência da API de macros são enviadas, nunca o documento. Os rascunhos aparecem apenas na caixa de edição e nunca são salvos nem executados automaticamente.
