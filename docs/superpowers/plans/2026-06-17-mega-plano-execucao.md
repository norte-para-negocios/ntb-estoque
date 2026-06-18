# NTB Estoque — MEGA PLANO de execução (17/06/2026)

> Plano de FASES consolidando os pedidos/bugs da reunião 17/06 (ver
> `2026-06-17-pedidos-reuniao.md`, seções VISÃO + A-O). Cada tarefa tem deliverable
> testável e é validada RODANDO no navegador antes de dar por pronta.

**Goal:** Estabilizar os bugs e entregar os pedidos da reunião, preparando o sistema pra
substituir o Omie no futuro (banco = fonte da verdade).

**Constraints globais:** custo zero (free tier) · commit no branch `joaquim/plano-omie-15-06`
→ merge `main` → push · ver a UI rodando antes de concluir · testes de escrita no Omie =
criar+excluir · sem travessão · assinar "Joaquim Salles" · histórico rolling 12 meses.

---

## FASE 0 — Estabilizar bugs (faz primeiro: trava o uso real)
| # | Tarefa | Onde (provável) | Validação |
|---|---|---|---|
| 0.1 ✅ | Etiqueta: nunca imprimir 0; default 1 quando vazio | geração de etiqueta / impressão | gerar etiqueta sem nº → sai 1 |
| 0.2 ✅ | Unidade de medida + quantidade zero ao add produto | OP/transf/inventário (ProdutoSearch + linha do item) | add produto → unidade aparece, qtd começa 1 |
| 0.3 ✅ | Transferência não "volta"/zera o produto | `lib/actions/transferencia.ts` + tela contagem | transferir → produto fica, não some no refresh |
| 0.4 ✅ | Inventário trava em "Iniciado" | fluxo de envio do inventário | item com erro não trava os outros |
| 0.5 ✅ | Cabeçalho fixo (sticky) das tabelas (eu removi) | `ui-kit/Lista.tsx`, `DataTable.tsx` | rolar → cabeçalho fica cravado + cantos curvos |
| 0.6 | CMC/estoque negativo: sinalizar | tela produto/posição | produto negativo aparece sinalizado |
| 0.7 | Estoque mínimo sumindo | sync/tela produto | mínimo aparece em todos |
| 0.8 ✅ | Sugestão de preço só com preço de venda | `app/(app)/produto/page.tsx` | sem preço de venda → sem sugestão |
| 0.9 ✅ | NF por loja (investigar vs Omie) | `db.mjs` + sync NF | confirmar se falta mês real ou é tela |

## FASE 1 — Operação (inventário/transferência + movimentações + OP)
| # | Tarefa | Onde | Validação |
|---|---|---|---|
| 1.1 ✅ | Inventário/transferência: **envio item-a-item** (sai do campo→envia; mexeu→reprocessa; erro passa adiante) | ContagemInventario/Transferencia + actions | lançar item → integra na hora |
| 1.2 ✅ | Inventário: editar/excluir item + imprimir da lista | tela inventário | editar item finalizado; imprimir direto |
| 1.3 ✅ | Movimentações: **filtros completos** (tipo mov, rejeito, PDV, local, família, origem) | `app/(app)/movimentacoes` | cada filtro funciona |
| 1.4 ✅ | Movimentações: **valor (R$) x quantidade** alternável + por mês/data | idem | alternar valor/qtd; agrupar por mês |
| 1.5 ✅ | OP: **reverter** (concluída) + **excluir** (aberta) | varredura Omie + action OP | reverter/excluir testado (criar+limpar) |
| 1.6 ✅ | Botões rápidos de status (Concluídos/Pendentes) em cima da tabela | OP/inventário/transf | 1 clique filtra |

> **Notas Fase 1 (18/06, Joaquim Salles):**
> - **1.3 origem/tipo-de-movimentação/local/rejeito/PDV:** a tabela `movimentos_historico`
>   só tem entradas/saídas em QUANTIDADE por (loja, produto, dia). Não há coluna de
>   origem, tipo de movimentação, local nem PDV ali (o backfill veio do agregado de
>   `ListarMovimentos`). Implementados os filtros que existem: data (com presets),
>   produto, **família**, tipo de produto. Para tipo-de-movimentação/local/rejeito/PDV
>   seria preciso reimportar o movimento granular do Omie (movestoque por linha) — fica
>   pra uma fase de dados. Não inventei colunas.
> - **1.4 valor (R$):** o histórico só tem quantidade; o valor é ESTIMADO = qtd × CMC
>   recente do produto (RPC `cmc_recente_da_loja`, migration 017). Aviso na tela.
>   Observação: alguns produtos têm CMC cadastrado errado no Omie (ex.: "Casquinha de
>   siri" com CMC de R$ 100 bi), o que infla o total — é dado a corrigir na origem.
> - **1.5 reverter/excluir:** testado no Omie real (loja 3, produto 70011 com estrutura):
>   incluir → concluir → **ReverterOrdemProducao** (Omie: "conclusão revertida com
>   sucesso, movimentos de estoque estornados") → **ExcluirOrdemProducao** ("excluída
>   com sucesso") → consulta confirma que sumiu. Criado+limpo, sem lixo.

## FASE 2 — UI / polimento + exportação
| # | Tarefa | Onde | Validação |
|---|---|---|---|
| 2.1 ✅ | Scroll customizado (estilizado, fino) global | globals.css / shell | scroll bonito em todas as telas |
| 2.2 ✅ | Produtos selecionados mais finos/compactos | listas de seleção | linhas mais finas |
| 2.3 ✅ | Busca de produto melhor (OP/transf/inventário) | `ProdutoSearch` + action | busca rápida/inteligente |
| 2.4 ✅ | Exportar **PDF bonito** + escolher conteúdo pelos filtros antes | rotas de impressão/export | filtra → escolhe → PDF só com aquilo |
| 2.5 ✅ | Exportar **Excel (.xlsx) lindo** (não CSV) | export + lib xlsx | planilha formatada |
| 2.6 ✅ | NF: total do período no topo (nº notas) | tela NF | mostra "N notas de X a Y" |

> **Notas Fase 2 (18/06, Joaquim Salles):** todas as tarefas feitas, no ar e validadas no
> link (https://ntb-estoque.vercel.app):
> - **2.1 scroll:** scrollbar própria fina/arredondada com respiro e hover, tokens
>   claro/escuro, em `globals.css` (WebKit `::-webkit-scrollbar` + Firefox
>   `scrollbar-width/color`). Vale para janela e qualquer container que rola. Vista na tela
>   de Movimentações (dark) e nas demais.
> - **2.2 produtos finos:** as listas de seleção de OP, transferência e inventário viram uma
>   linha só no desktop (descrição + controles na mesma altura, `lg:size-8`, input `lg:h-8`,
>   espaçamento menor). No mobile mantém cards e alvos de toque grandes (`size-11`). Visto na
>   Nova OP (3 produtos numa linha fina cada).
> - **2.3 busca melhor:** a busca quebra o termo em PALAVRAS e exige cada uma (AND, em
>   descrição OU código): "arroz bco" acha "ARROZ BCO" sem depender da frase literal nem da
>   ordem (validado no banco e no link, retorna os 3 Arroz Bco). Resultados de texto
>   reordenados por relevância (prefixo > palavra inteira > resto). Dropdown ganhou estados
>   "Buscando..." e "Nenhum produto encontrado", debounce 180ms e guarda de corrida. Vale nas
>   3 telas (todas usam `ProdutoSearch`).
> - **2.4 PDF bonito + filtros:** a rota `/nota-fiscal/relatorio` passou a respeitar TODOS os
>   filtros da tela (status, tipo, produto), não só data/fornecedor/número, então o que está
>   na tela é o que sai no PDF (validado no link: `status=C` derruba de 98 notas/R$157mil para
>   38 notas/R$72mil). PDF refinado: bloco de resumo no topo (período, nº notas, total),
>   coluna Etapa, cabeçalho na cor da marca, zebra, rodapé numerado, paginação.
> - **2.5 Excel .xlsx:** novo helper `lib/excel.ts` com **exceljs** (MIT, free) gera planilha
>   formatada de verdade: cabeçalho colorido (teal), zebra, larguras, formato moeda/número
>   pt-BR, linha de totais, painel congelado. Exportações de NF, OP e Produtos saíram de CSV
>   para `.xlsx`; botões "Exportar" viraram "Excel". Validado em produção: content-type xlsx,
>   assinatura ZIP, e ao reabrir o arquivo baixado os estilos/totais/moeda estão lá.
> - **2.6 total NF:** o totalizador da tela NF mostra "N notas de X a Y" numa frase só (nº de
>   notas + intervalo de datas, no estilo que o Ramon pediu) + chip de Total em R$. Visto no
>   link: "163 notas de 19/05/2026 a 18/06/2026".
>
> Nenhuma escrita no Omie nesta fase (a Nova OP usada para testar a 2.2/2.3 ficou em rascunho,
> não cliquei em "Criar"; nada foi gravado).

## FASE 3 — Cadastros + estrutura de produto
| # | Tarefa | Onde | Validação |
|---|---|---|---|
| 3.1 ✅ | **Estrutura de produto (BOM)**: itens, kg, rendimento, ver consumo | cadastro produto + Omie (malha) | cadastrar ficha; ver consumo na OP |
| 3.2 ✅ | Cadastro de **fornecedor** (+ puxar do Omie) | nova tela/cadastro | criar/listar fornecedor |
| 3.3 ✅ | Cadastro de **família** | nova tela/cadastro | criar/listar família |
| 3.4 ✅ | Cadastro de **cliente** + CEST | nova tela/cadastro | criar/listar |
| 3.5 ✅ | **Endereço das lojas** (+ puxar do Omie) | cadastro de loja | informar/puxar endereço |
| 3.6 ✅ | **SINTEGRA**: puxar cadastros por CNPJ | nova tela | puxar produto/cliente/fornecedor |

> **Notas Fase 3 (18/06, Joaquim Salles):** tudo no ar e validado no link
> (https://ntb-estoque.vercel.app), logado como Admin na loja DONANA RIO VERMELHO.
> **Banco = fonte da verdade** (visão de independência): cadastros são LOCAIS no Supabase;
> o Omie é só LEITURA ("puxar" preenche o banco). **NENHUMA escrita no Omie nesta fase.**
> Migrations 018 (tabelas familias/fornecedores/clientes + status por loja + permissões
> Familias/Fornecedores/Clientes e -Sincronizar) e 019 (fix do ON CONFLICT).
> - **3.3 Famílias:** tela `/familia` (criar/editar/excluir LOCAL + "Puxar do Omie").
>   Grafia certa da API é **PesquisarFamilias** (`ListarFamilias` NÃO existe, confirmado por
>   probe). Validado no link: 59 famílias puxadas da loja 3 (ARTESANAIS, Bases, Kids, etc.),
>   com origem Omie/Local, código Omie e situação.
> - **3.2 Fornecedores:** tela `/fornecedor` (CRUD local + puxar). Fornecedor/cliente moram
>   na MESMA base do Omie (`ListarClientes`); a **tag** distingue
>   (`clientesFiltro.tags=[{tag:'Fornecedor'}]`). Validado: 758 fornecedores puxados, com
>   razão social, CNPJ/CPF, cidade/UF, busca e paginação.
> - **3.4 Clientes + CEST:** tela `/cliente` idêntica (tag 'Cliente' = 2.585 puxados) + campo
>   **CEST local**. O Omie NÃO tem CEST no cadastro de cliente (confirmado por
>   `ConsultarCliente`); CEST é do produto, mas o Ramon pediu o campo no cadastro fiscal de
>   cliente, então fica como campo local opcional. Validado: dialog de edição mostra o CEST.
> - **3.5 Endereço da loja:** o backend já existia (`syncEmpresa` puxa o endereço da empresa
>   via `ListarEmpresas`; `LojaForm` já edita cep/uf/cidade/bairro/logradouro/número). Faltava
>   EXIBIR: a tela de loja agora mostra o bloco **Endereço** (visto no link: "R PRAIA DE ITAPUA,
>   S/N · LOTEAMENTO VILAS DO ATLANTICO - LAURO DE FREITAS (BA)/BA · CEP 42700-130"). O botão
>   "Puxar dados do Omie" preenche o endereço.
> - **3.6 SINTEGRA:** tela `/sintegra`, consulta por CNPJ/CPF no Omie
>   (`clientesFiltro.cnpj_cpf`, LEITURA), mostra o cadastro + a tag e importa para fornecedor
>   e/ou cliente LOCAL. Validado no link com CNPJ 11.537.003/0001-85 (achou "CELSO TEIXEIRA DE
>   SALES", tag Fornecedor, dados completos; import gravou no banco sem duplicar).
>   *Limite real:* o Omie só localiza quem JÁ está cadastrado lá (cliente/fornecedor). A
>   consulta pública na Receita/SINTEGRA externa (razão social + IE de qualquer CNPJ, mesmo
>   fora do Omie) exigiria um serviço externo (fora do custo-zero por ora). Produto não tem
>   busca por CNPJ. Documentado, não inventado.
> - **3.1 Estrutura de produto (BOM):** botão **"Estrutura"** na linha do produto abre a ficha
>   técnica. Grafia certa: `v1/geral/malha` / **ConsultarEstrutura** `{idProduto}` (descoberta
>   por probe). Mostra os **componentes** (código, descrição, família, qtde, unidade KG/UN/LT,
>   perda %) e o **consumo real da última OP concluída** (de `itensDetalhes` do full_object já
>   no banco, sem chamada extra ao Omie). Validado no link com "Camarão a Joel 600 G - Vatapá":
>   9 componentes + consumo da OP 2026/00219652 (consumo = ficha × qtde produzida, ex.: ficha
>   0,41 → consumo 0,82 em 2 unidades), coluna "Do estoque" Sim/Não.
>   **NÃO escrevemos a malha no Omie** (regra crítica): só leitura/exibição. A EDIÇÃO da ficha
>   técnica fica para validar com o Ramon (aviso na própria tela). Quando o produto não tem OP
>   concluída no banco, o bloco de consumo informa isso (visto no "Filé de Peixe c/ Purê").

## FASE 4 — Usuários / permissões / onboarding
| # | Tarefa | Onde | Validação |
|---|---|---|---|
| 4.1 | Permissões granulares por módulo ao criar usuário | tela usuário + auth | escolher permissões |
| 4.2 | Esconder do menu o que não tem permissão | shell/NavItems + auth | menu só mostra o permitido |
| 4.3 | Esconder seletor de loja p/ quem só tem 1 (mostrar só o nome) | shell | 1 loja → sem dropdown |
| 4.4 | **Admin por loja** (multi-admin, mais logins) | auth/perfis | cada loja com seu admin |
| 4.5 | **Onboarding por código de loja** (alinhar c/ André 18/06) | fluxo de cadastro/login | código → perfil → loja → login |
| 4.6 | Visual do cadastro de usuário (tá feio) | tela usuário | UI revisada |

## FASE 5 — Relatórios + independência do Omie
| # | Tarefa | Onde | Validação |
|---|---|---|---|
| 5.1 | Relatórios (Bloco 7): agregações + gráficos + PDF/Excel | novo módulo | relatórios saem certos |
| 5.2 | Preparar independência do Omie (banco = fonte da verdade) | arquitetura | cadastros/histórico próprios completos |

## Ordem recomendada
FASE 0 (inteira) → 1.1/1.2 (inventário/transf) → 1.3/1.4 (movimentações) → resto da 1 →
FASE 2 → FASE 3 → FASE 4 (depende do André) → FASE 5.
