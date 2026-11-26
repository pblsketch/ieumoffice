# Hangul (HWP / HWPX): edição, painel de trabalho e impressão

O GenOffice abre e edita documentos Hangul `.hwp` e `.hwpx` em uma guia, mantendo os atalhos do Hancom Hangul 2024, estilos, tabelas, notas, impressão e um painel de IA. Tudo roda localmente no seu PC.

## Abrir, salvar e imprimir

- Abre arquivos `.hwp` e `.hwpx` a partir da tela Início, **Arquivo > Abrir**, arrastando para a janela ou pelo Google Drive; converte PDFs em novas guias Hangul via **Arquivo > Importar PDF**.
- Salva novamente no formato original do arquivo aberto (`.hwp` continua `.hwp`, `.hwpx` continua `.hwpx`), mantém um backup `.bak` antes da primeira sobrescrita, verifica a releitura de HWP e guarda cópias de salvamento automático e recuperação após falhas.
- Imprimir (Ctrl+P) oferece visualização ao vivo, exportação em PDF e opções de layout de impressão com várias páginas.

## Painel de trabalho esquerdo: Estrutura e Localizar

- Abra o painel de trabalho esquerdo pelo botão na barra superior, em **Exibir > Painel de trabalho** (Estrutura / Localizar), ou pressione **Ctrl+F** para ir direto à guia Localizar. O Localizar tradicional (**Ctrl+Q,F**) e o Localizar e substituir (**Ctrl+H**) continuam disponíveis.
- **Guia Estrutura**: lista os títulos de estrutura nativos do Hangul e os títulos mapeados por estilo (padrão `제목 N` / `Heading N`, personalizável por documento ou em todo o aplicativo na gaveta de configurações da Estrutura). Filtre por nível (`1`, `2`, `3`, ... Todos), recolha ramos, clique para saltar, promova ou rebaixe títulos (com subtítulos por padrão, ou segure **Shift** para um único título) e arraste títulos para reordenar seções inteiras em uma única etapa de desfazer.
- **Guia Localizar**: pesquisa no corpo do texto, tabelas (incluindo tabelas aninhadas), caixas de texto, notas de rodapé e notas de fim (excluindo cabeçalhos e rodapés), com filtros de maiúsculas/minúsculas, palavra inteira, expressões regulares, estilo de parágrafo e formatação de caracteres. Clique em um resultado para saltar e selecioná-lo, ou substitua uma, as selecionadas ou todas as ocorrências em uma única etapa de desfazer (ignorando objetos embutidos e marcas de citação com contagem).
- O painel de trabalho lembra seu estado aberto, guia ativa e largura, recolhe-se em uma barra de ícones em janelas estreitas e oculta-se no modo de apresentação e na visualização de impressão. Todos os recursos do painel funcionam sem IA.

## Notas, atalhos e painel de IA

- Abra a coluna de notas pela barra superior ou em **Inserir > Nota** para ler, adicionar, editar e excluir notas em texto simples ao lado do documento.
- Usa os atalhos de teclado do Hancom Hangul 2024, marcadores de parágrafo na régua horizontal, Copiar formatação (**Alt+C**), conversão de Hanja (**F9** / tecla Hanja) e Informações do documento (**Ctrl+Q,I**).
- O painel de IA opcional e os [comandos de terminal](help://cli) (`ieumoffice hwp read`, `ieumoffice hwp apply`) podem ler e editar texto, estilos, tabelas, equações, layout de página, estrutura e resultados de pesquisa; cada edição de IA equivale a uma única etapa de desfazer.
