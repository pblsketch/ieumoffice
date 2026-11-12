# O painel do assistente de IA

Todos os editores podem chamar o painel de IA: selecione algo, dê uma instrução e veja o resultado a chegar.

## Abrir e usar

- O painel precisa de uma IA conectada. Se não houver nenhuma, mostra os cartões de conexão em vez de um erro; consulte [Conexão por assinatura](help://subscription).
- Pontos de entrada: o **botão de IA** no friso de cada editor, **Perguntar à IA** nos menus de contexto, ou Perguntar à IA na barra de marcação.
- Descreva a tarefa por palavras normais (reescrever isto / transformar esta coluna em percentagens / refazer a disposição desta página...) e prima Enter.
- As respostas são renderizadas **em fluxo**; quando a IA precisa de ferramentas (ler o documento, editá-lo), executa-as e continua até terminar.
- **Parar**: interrompe a volta em curso a qualquer momento.
- **Fila de espera**: enquanto uma resposta chega, Enter coloca sua mensagem na fila em vez de descartá-la — uma faixa acima do campo de entrada conta quantas; abra-a para editar, remover, reordenar, pausar ou limpar. A mensagem seguinte parte sozinha ao fim do turno; Esc continua parando o turno.

## Que IA responde

- A lista de modelos ao fundo do painel mostra a IA em uso e permite escolher outra: primeiro as suas assinaturas, depois os fornecedores com chave que configurou.
- Depois de ter usado 80% ou mais do limite de uma assinatura, aparece no painel uma linha como «85% usado · redefine às 15:00».
- Se um pedido for interrompido — o limite esgotou-se, ou o login expirou —, o painel diz porquê e não muda sozinho para outra IA. Quando a sua outra assinatura está conectada, um botão **Continuar com …** propõe-na.

## O que sabe fazer

- **Docs**: reescrever, desenvolver, traduzir, resumir, inserir tabelas e imagens, ajustar a formatação; cada volta guarda um instantâneo primeiro.
- **Sheets**: fórmulas, preenchimento de dados, transformações em massa, formatação.
- **Slides**: gerar a apresentação inteira, ajustar o layout, reescrever os textos.
- **PDF**: perguntas e respostas e resumos com base no texto ou nas páginas selecionadas.
- **Markdown / HTML**: reescrever, desenvolver, traduzir.
- **Início ▸ Ask AI** responde a partir dos seus arquivos favoritados e os cita — o painel de base de conhecimento tem a própria seção no capítulo Início, e o painel de IA do Docs carrega a mesma capacidade.

## Anexar documentos abertos

No painel de IA dos editores Docs, Sheets, Slides, Hangul, HTML e mapa mental, você pode anexar como material outros documentos abertos no GenOffice ou abertos recentemente. Um documento anexado é tratado exatamente como um arquivo escolhido no seu PC.

- **`@` no campo de entrada**: digite `@` no início do campo ou depois de um espaço para abrir uma lista de documentos. Se a janela estiver dividida, o documento do outro painel vem primeiro, depois os outros documentos abertos e os recentes; o documento em que você está fica de fora. Filtre com algumas letras do nome (espaços são aceitos) e escolha com Enter ou um clique: `@nome do documento` entra no campo e o documento é anexado. **Procurar mais…**, no fim da lista, abre a janela de escolha de documentos descrita abaixo.
- **Anexar de documentos do GenOffice**: este botão, ao lado do botão de anexo, abre a mesma lista em uma janela, onde você pode marcar vários documentos e anexá-los de uma vez.
- Documentos com alterações não salvas e documentos novos que nunca foram salvos aparecem esmaecidos e não podem ser escolhidos. Salve-os e escolha de novo: a IA lê o arquivo salvo.
- Quando dois documentos têm o mesmo nome, mas estão em pastas diferentes, o nome da pasta logo acima é acrescentado, como em `@plano.docx(2º semestre)`, e esse nome de pasta também é passado à IA.
- Os editores de PDF e Markdown ainda não têm anexos, então nenhuma das duas formas está disponível neles.

## Projetos

- Clique no nome do projeto, à esquerda e abaixo do campo de entrada, para escolher um projeto (uma pasta do seu PC). A IA passa a responder conhecendo os arquivos, as instruções e a memória dessa pasta, e a conversa fica guardada nela para você continuar em outro editor. Veja [Projetos](help://projects).
- Com um projeto escolhido, o título da conversa atual aparece no topo do painel. Clique nele para ver a lista de conversas do projeto e **Nova conversa**.
- A lista de `@` do campo de entrada mostra "Arquivos deste projeto" depois dos documentos abertos.
- Um pedido com um projeto escolhido também envia à IA que você está usando as instruções (junto com `AGENTS.md` e `CLAUDE.md` no topo da pasta, que você pode desativar na página do projeto), a memória e a lista de nomes de arquivo desse projeto, um trecho curto de cada arquivo que a IA encontrar ao pesquisar a pasta, além do texto de qualquer arquivo que a IA ler.

## Reversão e segurança

- O painel do Docs mantém uma **lista de versões**: um instantâneo por volta, pode voltar a qualquer um deles, e a própria reversão pode ser anulada com Ctrl+Z. Os instantâneos sobrevivem a fechar e reabrir o documento.
- As edições da IA passam pelo mesmo fluxo de edição das manuais (anuláveis e sujeitas a salvamento) — nada contorna a sua confirmação de salvamento.

## Ocultar informações sensíveis

- Nos editores Docs, Sheets, Slides, Hangul, Markdown e HTML você pode impedir que uma parte do documento chegue à IA: selecione-a, clique direito ▸ **Ocultar informações sensíveis** e dê a ela um rótulo. A IA lê `{{rótulo}}` no lugar, seja qual for a IA que você usa. (Markdown arma o item com a chave de olho riscado da faixa; o do HTML fica no painel de código; no Sheets, clique direito no cabeçalho de uma coluna para ocultar a coluna abaixo da linha de cabeçalho, ou num intervalo de células para ocultar só esse intervalo.)
- O arquivo guarda o texto real: salvar, imprimir e exportar para PDF ficam intactos, e a marca sobrevive à reabertura. O mesmo menu deixa de ocultar. No Hangul cada parte oculta é um comentário com o texto `[Ocultar informações sensíveis] rótulo`, então quem receber o documento também vê esse comentário, e um texto que já tem comentário não pode ser ocultado. No Sheets a marca é um nome definido `IeumHide_rótulo`, que aparece no Gerenciador de Nomes; a IA vê cada célula oculta como `{{rótulo-01}}` (o mesmo valor recebe o mesmo número), e uma célula cuja fórmula usa células ocultas também fica oculta.
- **Procurar informações sensíveis**, no painel de IA, lista o que parece nome, número de telefone, endereço de e-mail, número de registro de residente, número de conta e de cartão, endereço e afins. A busca é feita neste PC só com padrões de texto fixos — nenhuma IA é usada para encontrar ou ocultar nada — e nada fica oculto até você escolher **Ocultar**. **Excluir** impede que um candidato volte a aparecer naquele documento. Os lugares que não podem receber uma marca (um cabeçalho, uma anotação do apresentador, um nome de planilha…) aparecem na lista para você mesmo editar.
- Na primeira vez que você envia algo numa aba, se o documento ou os anexos daquele pedido ainda tiverem candidatos assim, o painel pergunta uma vez: **Conferir** não envia nada e abre a lista; **Enviar mesmo assim** envia.
- HTML oculta conteúdos de elementos, valores de atributos e literais de string dos scripts, e a página renderizada nunca muda. Slides também oculta imagens, vídeos e áudios inteiros, e um slide com conteúdo oculto nunca é enviado como captura.
- As partes ocultas continuam ocultas quando o arquivo é anexado em outro editor, quando você pergunta sobre ele no Início, quando o comando `ieumoffice` e suas ferramentas MCP o leem ou quando ele é lido pelo servidor MCP do aplicativo. Converter para um formato sem lugar para a marca (ODT, CSV…) pergunta antes. A ocultação não alcança arquivos que um programa no modo agente lê direto do disco, e as imagens de página (`render`) mostram o texto como está.

## Privacidade

- As instruções e o conteúdo relevante do documento vão para **a IA que está a usar**: para a Anthropic ou a OpenAI pela sua própria conta quando usa uma assinatura, ou para o fornecedor cuja chave introduziu. Sem nenhuma IA conectada, nada é enviado.
- Se o conteúdo de uma assinatura é usado para treinar IA depende das configurações da sua própria conta nessa empresa.
- Os ficheiros locais não são carregados para lado nenhum; as chaves de API ficam guardadas no ficheiro de definições da aplicação nesta máquina e são enviadas apenas nos cabeçalhos dos pedidos.
