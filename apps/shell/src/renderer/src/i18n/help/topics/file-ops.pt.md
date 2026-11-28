# Operações de arquivo: renomear, excluir, exportar

Este capítulo cobre as operações de arquivo comuns a todos os editores; as opções de exportação de cada editor estão no respetivo capítulo.

O **menu ⋯** da linha do arquivo (passe o cursor sobre a linha do arquivo) reúne estas ações:

![O menu ⋯ de uma linha de arquivo](img/file-ops.png)

## Renomear

Dois pontos de entrada, um conjunto de verificações:

- **⋯ ▸ Renomear** a partir de uma linha no ecrã Início.
- **Clique duas vezes numa guia de ficheiro** para renomear no local (consulte [Guias e gestão de janelas](help://tabs-and-windows)).

As regras: a extensão é preservada automaticamente; caracteres proibidos, pontos no final e nomes reservados (CON/NUL e afins) são recusados com uma mensagem; e um nome em conflito na mesma pasta também é bloqueado. O ficheiro real no disco é renomeado, e a lista de recentes e os favoritos acompanham.

## Excluir

- **⋯ ▸ Excluir** no Início: pergunta quais os ficheiros e depois move-os para a **lixeira do sistema**, onde o sistema operacional os pode restaurar. O GenOffice não guarda nenhum desfazer próprio para isto — a recuperação é responsabilidade da lixeira, não de um aviso.

## Duplicar

**⋯ ▸ Duplicar** cria uma cópia de <nome> na mesma pasta; se houver colisão de nome, um contador é acrescentado automaticamente. A cópia entra nos **Recentes** em vez de ser aberta por si — a um clique de distância, não à sua frente.

## Salvar e Salvar Como

- **⌘S / ctrl+S** salva o ficheiro atual; um ficheiro sem título pergunta primeiro pela localização e pelo nome.
- Na maioria dos editores, a lista de tipos de ficheiro da caixa Salvar Como também oferece os formatos de exportação (PDF, imagens, outros formatos de documento). Escolher um deles grava apenas uma cópia; o documento aberto e o seu separador continuam no ficheiro original. Imagens de várias páginas são divididas em `nome-01.png`, `nome-02.png`, ….
- **Docs**: a lista Guardar como também oferece .hwp e .hwpx (Ficheiro ▸ Exportar como documento HWP… faz o mesmo). Se algo não puder ser transferido, como comentários, equações ou caixas de texto, é avisado antes de o ficheiro ser escrito.
- **Salvar Como…** grava um ficheiro novo e deixa o original intacto; as edições seguintes passam a incidir sobre o ficheiro novo.
- Cada gravação é atómica (ficheiro temporário + mudança de nome), pelo que sair a meio da escrita não corrompe o ficheiro.
- O salvamento automático segue o interruptor de cada editor; um documento novo sem ficheiro próprio só começa após o primeiro salvamento (consulte [Início rápido](help://getting-started)).

## Exportar para PDF

- **Docs**: Arquivo ▸ Exportar como PDF… (ou o botão no friso), paginado conforme a disposição atual.
- **Slides**: a exportação rasteriza página a página, com progresso para apresentações grandes.
- **Sheets**: a exportação segue a paginação de impressão.
- As exportações são renderizadas numa janela oculta e o resultado fica onde você escolher.

## Exportar para Word / imagens

- **PDF ▸ PDF para Word**: transforma o PDF num .docx (convertido localmente;layouts complexos são preservados tanto quanto possível).
- O **Docs** pode exportar páginas como imagens (PNG por página).

## Imprimir

Arquivo ▸ Imprimir (⌘P/ctrl+P) abre uma janela de impressão com pré-visualização ao vivo em todos os editores — Docs, Sheets, Slides, PDF, Markdown, Hangul, HTML, Mind Map, Diagram e Whiteboard. Sem alterar o Layout de página e usando a caixa de diálogo do sistema, a impressão funciona como antes.

- **Destino (impressora, PDF, imagens)**: escolha numa única lista uma impressora instalada, **Salvar como PDF**, **Salvar como imagens** ou **Diálogo de impressão do sistema**. A exportação de imagens oferece PNG e JPG (Alta 90%, Média 80%, Arquivo menor 65%), em arquivos numerados ou compactados em um ZIP. PDFs com restrições bloqueiam PDF e imagens, mantendo a impressão ativa.
- **Pré-visualização ao vivo**: todos os dez editores exibem pré-visualização antes da saída. Quando layout, tons de cinza, marca d’água ou cabeçalhos/rodapés alteram as faces finais, a visualização renderiza sob demanda com navegação, zoom e alternância para o esquema.
- **Layout**: escolha Uma página por folha, Várias páginas por folha (2, 4, 6, 9 ou 16, com bordas opcionais), Livreto (encadernação esquerda ou direita), Pôster (colunas × linhas, sobreposição, marcas de corte e coordenadas dos blocos) ou Etiquetas (uma página por etiqueta ou repetida, célula inicial, formatos A4 ou medidas personalizadas).
- **Escala, orientação, lados e ordem**: selecione Tamanho real (100%), Ajustar ao papel, Reduzir páginas maiores ou Escala personalizada (10%–400%), além de orientação Automática, Retrato ou Paisagem. Apenas ímpares, apenas pares e ordem inversa contam os lados finais.
- **Marca d’água, cabeçalhos/rodapés, tons de cinza e resolução**: adicione marca d’água de texto ou imagem e 6 posições de cabeçalho/rodapé (título, data, número da página ou texto livre) apenas na saída, sem modificar o documento. Escolha também tons de cinza e resolução (Automática, 150, 300 ou 600 dpi).
- **Intervalos de páginas e seleção**: Docs e Markdown paginam o texto selecionado a partir da página 1; Slides imprime slides selecionados; PDF imprime páginas selecionadas; Hangul aceita Tudo, Página atual ou Intervalo personalizado; Sheets imprime planilhas ativas, pasta inteira ou seleção.
- **Diálogo do sistema**: para livretos, ative frente e verso pela borda curta e mantenha intervalo e páginas por folha inalterados no diálogo do sistema.

Os PDFs são impressos na ordem e rotação atuais das páginas.

## Onde vivem os ficheiros sem título

A localização que escolher no primeiro salvamento é a casa dele. Até lá, o documento não tem ficheiro próprio: o conteúdo não salvo existe apenas como cópia de recuperação na pasta de dados da aplicação, por isso pode voltar se a aplicação se desligar de repente (veja [Guias e gestão de janelas](help://tabs-and-windows)). O Salvamento automático só assume a partir desse primeiro salvamento.
