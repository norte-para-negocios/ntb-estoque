# Norte Cozinha: o que o app separado tem e a área /cozinha do ERP ainda não tem

Comparação feita só por leitura de código (ticket 11 do robô, 18/11/2026):

- App separado: `sistemas/norte-cozinha` (Next 16 + Postgres próprio + Drizzle, multiempresa, login próprio). Telas em `app/(app)/`, regras em `lib/` e `components/`.
- Área do ERP: `app/(app)/cozinha/` + `lib/custo-cardapio/` + `lib/actions/cozinha-*.ts` + `components/custo-cardapio/`.

Nada foi subido nem alterado no app separado. A lista abaixo diz "falta" quando a ação não existe dentro de `/cozinha` (mesmo que exista em outra tela do ERP, o que vem anotado). Cada item foi conferido procurando a tela, a server action ou o componente nos dois lados.

## 1. O que o app separado faz e a /cozinha não faz

| # | Função do app separado | Onde está lá | Na /cozinha do ERP |
|---|---|---|---|
| 1 | Criar insumo (nome, categoria, unidade de compra, quantidade por compra, preço de compra, fator de correção, estoque mínimo, fornecedor) | `insumos/novo`, `FormInsumo`, `salvarInsumo` | Falta. A /cozinha só lista os insumos (folhas das fichas); criar e editar é no cadastro de Produtos do ERP ("Abrir no estoque"). |
| 2 | Editar, inativar/reativar e excluir insumo na própria tela | `insumos/[id]`, `AcoesInsumo` | Falta. Ficha do insumo na /cozinha é só leitura (custo, histórico de compra, onde é usado, simulador "e se o preço mudar"). |
| 3 | Importar insumos por planilha (modelo .xlsx, prévia com erros por linha, criar e atualizar) | `insumos/importar`, `modelo`, `previa`, `planilha.ts` | Falta, em toda a área. |
| 4 | Criar prato e preparação do zero na área (editor com ingredientes, busca de insumo/preparação, custo vivo) | `pratos/novo`, `preparacoes/nova`, `EditorReceita`, `salvarReceita` | Parcial. Não há "novo prato"; o produto nasce no cadastro e a ficha é montada no editor de estrutura embutido na página do prato. |
| 5 | Duplicar prato/preparação ("Cópia criada...") | `duplicarReceita` | Falta. (Cardápio tem Duplicar na /cozinha; prato e preparação não.) |
| 6 | Inativar/reativar e excluir prato ou preparação na área | `alternarAtivo`, `excluirReceita` | Falta. Quem inativa é o cadastro de Produtos. |
| 7 | Porções por prato: a receita rende N porções e o custo/CMV é por porção | campo `porcoes` | Parcial. A ficha tem rendimento e o custo é por unidade do produto; não existe o conceito "receita de 10 porções". |
| 8 | Preço de delivery e custo de embalagem gravados POR PRATO | `precoDelivery`, `custoEmbalagem` em `receitas` | Falta. Embalagem é um valor único por loja (Configurações); o preço de delivery do painel do prato é só simulação ("Nada é salvo"). |
| 9 | Preço de venda editado na própria ficha do prato | `precoVenda` | Falta. O preço vem do cadastro do produto; só o cardápio guarda preço próprio por prato. |
| 10 | Separar ingrediente bruto x limpo na lista (fator de correção por insumo, "Separe X bruto") | `calculo.ts`, `EditorReceita` | Parcial. O fator de correção e a perda são por item da ficha no ERP, não por insumo; a ficha mostra a quantidade líquida, sem a linha "bruto". |
| 11 | Chef IA: botão que gera até 10 sugestões validadas contra os números (preço, delivery, porção, trocar insumo, combinação) e guarda a última | `chef/`, `lib/chef/logica.ts`, `chef_sugestoes` | Falta o formato. O Pacioli responde perguntas (modo rápido com perguntas prontas; conversa livre só com `ANTHROPIC_API_KEY`), mas não gera nem guarda um pacote de sugestões. |
| 12 | Estoque: lançar movimento (entrada, saída, perda, com motivo) pela área | `estoque/lancar`, `registrarMovimento` | Falta. A /cozinha/estoque só mostra; entrada e ajuste são nas telas do ERP (Movimentações, Notas). |
| 13 | Estoque: contagem (conferir e ajustar vários insumos de uma vez) | `estoque/contagem`, `confirmarContagem` | Falta dentro da área; só o botão "Inventário" que leva ao ERP. |
| 14 | Estoque: histórico de movimentos dos insumos | `estoque/historico` | Falta na área (existe em Movimentações do ERP). |
| 15 | Duplicar evento | `duplicarEvento` | Falta. (Eventos têm criar, salvar, excluir, status, finalizar, reabrir, baixa de estoque.) |
| 16 | Cliente do evento e margem de segurança em % por evento, com tela de impressão | `eventos` (`cliente`, `margemSeguranca`), `eventos/[id]/imprimir` | Parcial. A /cozinha tem folga de produção e PDF; não tem o campo "cliente". |
| 17 | Primeiros passos para quem acabou de entrar (3 passos: insumos, prato, cardápio) | `PrimeirosPassos` | Falta. A /cozinha mostra estados vazios com texto, sem o guia. |
| 18 | Histórico de preço do insumo em tabela própria (cada mudança de preço vira ponto) | `insumo_precos` | Diferente. O ERP infere a variação pelas notas de compra (30 dias contra 90 anteriores); não guarda "preço digitado em tal data". |
| 19 | Equipe e senha na própria área (adicionar pessoa, ativar/desativar, trocar senha, dados do restaurante) | `configuracoes`, `Equipe`, `FormSenha`, `FormRestaurante` | Falta na área. Usuários, cargos e loja ficam no ERP; Configurações da /cozinha tem só meta de CMV, taxas e compras/contagem. |
| 20 | Criar conta e várias empresas isoladas por login próprio | `criar-conta`, `orgId` em toda consulta | Não se aplica: no ERP o isolamento é por loja (RLS) e o login é o do ERP. |
| 21 | Categorias próprias de insumo e de receita | `categorias` | Diferente. A /cozinha usa a família do cadastro de Produtos; não há categoria só da cozinha. |
| 22 | Cadastro do insumo com "unidade de compra" em texto livre ("cx 12 un", "galão 5 L") e custo calculado de preço ÷ quantidade | `unidadeCompra`, `qtdPorCompra` | Diferente. O custo é o custo médio do estoque (notas e ajustes), na unidade base do produto. |

## 2. O que a /cozinha tem a mais (não precisa copiar)

Guia de preparo e modo cozinhar, foto e modo de preparo por receita, ficha em PDF (inclusive "Para a cozinha"), PDF do cardápio e do evento, preços para a meta no salão e no delivery por prato, CMV do prato típico, insumos que subiram no mês, valor em estoque, lista de compras com sugestão, reservas dos eventos, pedido em aberto, mensagem para o fornecedor no WhatsApp, finalizar evento com baixa no estoque, reorganizar itens do cardápio, porções e preço por item do cardápio, simulador "e se o preço mudar", Pacioli (assistente), módulo liberado por loja (`exigirModulo`).

## 3. Resumo para decidir

- Sem a /cozinha ter: lançar movimento/contagem de estoque (12, 13, 14), criar/editar/importar insumos (1, 2, 3), criar e duplicar pratos e preparações (4, 5, 6), preço de delivery e embalagem por prato (8) e o Chef IA de sugestões (11). São as funções que um dono usa no dia a dia no app separado.
- Diferenças de modelo (18, 20, 21, 22) são consequência de a área usar o cadastro e o estoque do ERP, e não precisam de cópia.
