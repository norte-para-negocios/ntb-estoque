# Matriz de permissões: cargo × tela / ação / API

Gerada por `npm run robo:permissoes -- --matriz` (e2e/robo/permissoes.ts) a partir do código do ERP e do banco da cópia local. Não edite à mão: mude `e2e/robo/permissoes-matriz.ts` (extras, botões, APIs) ou o código do ERP e gere de novo.

## Como a matriz é derivada

- Rota do menu: regra de `components/shell/NavItems.ts` (`admin` = perfil Admin; `gestaoUsuarios` = Admin ou AdminLoja; `superAdmin` = desenvolvedor) mais a permissão de `MENU_PERMISSAO` (`lib/permissoes-catalogo.ts`) mais `ROTAS_SO_DEV` (`lib/recursos-dev.ts`, vale também para as sub-rotas).
- Telas fora do menu e telas em que a página pede outra coisa que o menu: tabela `EXTRAS`, conferida em cada `page.tsx` (`requirePermissao`, `getAtorGestao().podeGerir`, `isAdmin`, `exigirDev`, `notFound`).
- Permissões de cada cargo: `cargo_permissao` do banco local (cópia do backup de 17/11/2026). Dono = Admin global + `is_super_admin` (passa em tudo). Gerente/Estoquista = perfil `Usuario` com o cargo na loja.
- Condições que só SOMAM restrição (loja em estoque próprio, módulo da plataforma, loja de teste) não entram na matriz: "sim" quer dizer "o cargo pode", não "a tela abre em toda loja". O robô só acusa furo quando a tela ABRE e a matriz diz "não".
- Rota bloqueada responde HTTP 200 com a página 404 do Next (achado do ticket 02): o robô lê o corpo, não só o código.

## Cargos no banco

| Cargo | Permissões | Login de teste |
|---|---|---|
| Gerente | 56 | sim (lojas 4, 15, 19) |
| Estoquista | 17 | sim (lojas 4, 15, 19) |
| Conferente | 8 | NÃO (não coberto) |

Permissões sem nenhum cargo: 34 de 90. Migration 310: 38 de 38 linhas já estão em `cargo_permissao` (aplicada).

Sem cargo (só Admin/AdminLoja alcançam):

`Categorias Contabeis - Criar`, `Categorias Contabeis - Editar`, `Categorias Contabeis - Excluir`, `Estoque - Corrigir custo`, `Familias`, `Familias - Criar`, `Familias - Editar`, `Familias - Excluir`, `Familias - Sincronizar`, `Fechamento - Reabrir mes`, `Financeiro - Aprovar pagamento alto valor`, `Financeiro - Categorias`, `Financeiro - Configurar aprovacao`, `Financeiro - Contas a pagar - Pagar`, `Financeiro - Contas a receber - Receber`, `Financeiro - Lancamentos e transferencias`, `Fornecedores`, `Fornecedores - Criar`, `Fornecedores - Editar`, `Fornecedores - Excluir`, `Fornecedores - Importar planilha`, `Fornecedores - Sincronizar`, `Locais de Estoque`, `Locais de Estoque - Criar`, `Locais de Estoque - Editar`, `Locais de Estoque - Excluir`, `Locais de Estoque - Sincronizar`, `Notas Fiscais - Excluir`, `Produtos`, `Produtos - Criar`, `Produtos - Editar`, `Produtos - Excluir`, `Produtos - Importar planilha`, `Produtos - Sincronizar`

## Telas (acesso direto ao endereço)

| Rota | Regra | dono | gerente | estoquista |
|---|---|---|---|---|
| /auditoria | livre | sim | sim | sim |
| /auditoria-fiscal | Admin ou AdminLoja | sim | não | não |
| /cargo | Admin ou AdminLoja | sim | não | não |
| /categoria-contabil | Categorias Contabeis | sim | sim | não |
| /central | dev | sim | não | não |
| /central/administracao | dev | sim | não | não |
| /central/compras | dev | sim | não | não |
| /central/estoque | dev | sim | não | não |
| /central/financas | dev | sim | não | não |
| /central/fiscal | dev | sim | não | não |
| /central/producao | dev | sim | não | não |
| /cliente | dev + Clientes | sim | não | não |
| /compras | livre | sim | sim | sim |
| /compras-cadastros | (Compras - Pedidos ou Compras - Aprovar pedidos) | sim | sim | não |
| /contador | dev + Admin ou AdminLoja + (Contador - Pacote ou Fechamento - Fechar mes ou Fechamento - Reabrir mes) | sim | não | não |
| /correcoes | Admin ou AdminLoja | sim | não | não |
| /cozinha | Admin ou AdminLoja | sim | não | não |
| /cozinha/cardapios | Admin ou AdminLoja | sim | não | não |
| /cozinha/configuracoes | Admin ou AdminLoja | sim | não | não |
| /cozinha/estoque | Admin ou AdminLoja | sim | não | não |
| /cozinha/eventos | Admin ou AdminLoja | sim | não | não |
| /cozinha/guia | Admin ou AdminLoja | sim | não | não |
| /cozinha/insumos | Admin ou AdminLoja | sim | não | não |
| /cozinha/pacioli | Admin ou AdminLoja | sim | não | não |
| /cozinha/pratos | Admin ou AdminLoja | sim | não | não |
| /cozinha/preparacoes | Admin ou AdminLoja | sim | não | não |
| /devolucao-fornecedor | dev + (Compras - Devolucao ao fornecedor ou Notas Fiscais) | sim | não | não |
| /estoque | Movimentacoes | sim | sim | sim |
| /estoque-local-teste | perfil Admin | sim | não | não |
| /estoque/ajustes | Movimentacoes | sim | sim | sim |
| /estoque/correcoes | Movimentacoes | sim | sim | sim |
| /estoque/fichas | Movimentacoes | sim | sim | sim |
| /estoque/kardex | Movimentacoes | sim | sim | sim |
| /estoque/quem-mexeu | Movimentacoes | sim | sim | sim |
| /estoque/saude | Movimentacoes | sim | sim | sim |
| /familia | Familias | sim | não | não |
| /faturamento | Admin ou AdminLoja | sim | não | não |
| /ficha-tecnica | livre | sim | sim | sim |
| /financeiro/aprovacoes | dev + Financeiro - Aprovar pagamento | sim | não | não |
| /financeiro/categorias | dev + Financeiro - Categorias | sim | não | não |
| /financeiro/contas-correntes | dev + Financeiro - Contas correntes | sim | não | não |
| /financeiro/contas-pagar | dev + Financeiro - Contas a pagar | sim | não | não |
| /financeiro/contas-pagar/nova | dev + Financeiro - Contas a pagar | sim | não | não |
| /financeiro/contas-receber | dev + Financeiro - Contas a receber | sim | não | não |
| /financeiro/dre | dev | sim | não | não |
| /financeiro/extrato | dev + Financeiro - Contas correntes | sim | não | não |
| /financeiro/familias | dev + Financeiro - Categorias | sim | não | não |
| /financeiro/fluxo-caixa | dev | sim | não | não |
| /financeiro/formas-recebimento | dev + Financeiro - Contas a receber | sim | não | não |
| /financeiro/lancamentos | dev + Financeiro - Lancamentos e transferencias | sim | não | não |
| /financeiro/notas-desfeitas | dev + Financeiro - Decidir nota desfeita | sim | não | não |
| /financeiro/notas-sem-conta | dev + Financeiro - Contas a pagar | sim | não | não |
| /financeiro/recorrentes | dev + Financeiro - Contas recorrentes | sim | não | não |
| /fornecedor | Fornecedores | sim | não | não |
| /fornecedor/importar | Fornecedores - Importar planilha | sim | não | não |
| /grupo-produto | Familias | sim | não | não |
| /historico-cadastro | dev + Produtos | sim | não | não |
| /home | livre | sim | sim | sim |
| /impressoes | Impressoes | sim | sim | sim |
| /inventario | Inventarios - Ver | sim | sim | sim |
| /inventario-proprio | livre | sim | sim | sim |
| /local-estoque | Locais de Estoque | sim | não | não |
| /log | perfil Admin | sim | não | não |
| /loja | perfil Admin | sim | não | não |
| /meta-mensal | Admin ou AdminLoja | sim | não | não |
| /migracao-omie | dev | sim | não | não |
| /minha-loja | Admin ou AdminLoja | sim | não | não |
| /movimentacoes | Movimentacoes | sim | sim | sim |
| /nfe-saida | dev + Compras - Emitir NF-e | sim | não | não |
| /nota-fiscal | Notas Fiscais | sim | sim | não |
| /nota-fiscal/etapas | Notas Fiscais | sim | sim | não |
| /nota-fiscal/importar | Compras - Criar | sim | sim | não |
| /nota-fiscal/nova | Compras - Criar | sim | sim | não |
| /ordem-producao | Ordens de Producao | sim | sim | sim |
| /ordem-producao/abertas | Ordens de Producao | sim | sim | sim |
| /ordem-producao/nova | Ordens de Producao - Criar | sim | sim | sim |
| /ordem-producao/teste | perfil Admin | sim | não | não |
| /pacioli | livre | sim | sim | sim |
| /pedido-compra | dev + (Compras - Pedidos ou Compras - Aprovar pedidos) | sim | não | não |
| /pedido-compra/importar | dev + Compras - Pedidos | sim | não | não |
| /pedido-compra/novo | dev + Compras - Pedidos | sim | não | não |
| /pendencias-classificacao | Admin ou AdminLoja | sim | não | não |
| /plataforma/modulos | dev | sim | não | não |
| /porta | dev | sim | não | não |
| /producao-propria | livre | sim | sim | sim |
| /produto | Produtos | sim | não | não |
| /produto/importar | Produtos - Importar planilha | sim | não | não |
| /produto/novo | Produtos - Criar | sim | não | não |
| /relatorio-cmv | dev + Admin ou AdminLoja | sim | não | não |
| /relatorio-compras | Admin ou AdminLoja | sim | não | não |
| /relatorio-consumo | dev + Admin ou AdminLoja | sim | não | não |
| /relatorio-curva-abc | Admin ou AdminLoja | sim | não | não |
| /relatorio-engenharia-cardapio | dev + Admin ou AdminLoja | sim | não | não |
| /relatorio-estoque-valorizado | Admin ou AdminLoja | sim | não | não |
| /relatorio-faturamento | Admin ou AdminLoja | sim | não | não |
| /relatorio-indicadores | Admin ou AdminLoja | sim | não | não |
| /relatorio-lucro | Admin ou AdminLoja | sim | não | não |
| /relatorio-margem | Admin ou AdminLoja | sim | não | não |
| /relatorio-mensal | Admin ou AdminLoja | sim | não | não |
| /relatorio-meta | Admin ou AdminLoja | sim | não | não |
| /relatorio-movimentacao | Admin ou AdminLoja | sim | não | não |
| /relatorio-ops | Admin ou AdminLoja | sim | não | não |
| /relatorio-perdas | dev + Admin ou AdminLoja | sim | não | não |
| /relatorio-posicao-estoque | dev + Admin ou AdminLoja | sim | não | não |
| /relatorio-producao | Admin ou AdminLoja | sim | não | não |
| /relatorio-produtos-fornecedor | dev + Admin ou AdminLoja | sim | não | não |
| /relatorio-variacao-preco | dev + Admin ou AdminLoja | sim | não | não |
| /relatorios | Admin ou AdminLoja | sim | não | não |
| /reposicao | Movimentacoes | sim | sim | sim |
| /requisicao-compra | dev + (Compras - Requisicoes ou Compras - Pedidos ou Compras - Aprovar pedidos) | sim | não | não |
| /requisicao-compra/novo | dev + (Compras - Requisicoes ou Compras - Pedidos ou Compras - Aprovar pedidos) | sim | não | não |
| /resumo | Admin ou AdminLoja | sim | não | não |
| /saude-banco | dev | sim | não | não |
| /sincronizacao | livre | sim | sim | sim |
| /sintegra | Fornecedores | sim | não | não |
| /sugestao-compra | dev + (Compras - Sugestao ou Compras - Pedidos ou Compras - Requisicoes) | sim | não | não |
| /sync-catalogo | Produtos | sim | não | não |
| /sync-status | perfil Admin | sim | não | não |
| /tarefas-compras | dev + (Compras - Aprovar pedidos ou Compras - Pedidos ou Compras - Requisicoes ou Notas Fiscais) | sim | não | não |
| /transferencia | Transferencias - Ver | sim | sim | sim |
| /transferencia-loja | dev + (Transferencias - Entre lojas ou Compras - Emitir NF-e) | sim | não | não |
| /usuario | Admin ou AdminLoja | sim | não | não |
| /validade | Validade | sim | sim | sim |

## Ações (botões que gravam)

Visíveis só com a regra abaixo. O robô lê o botão na tela; nunca o clica.

| Tela | Botão | Regra | dono | gerente | estoquista |
|---|---|---|---|---|---|
| /inventario | `^Novo inventário$` | Inventarios - Criar | sim | sim | sim |
| /inventario | `^Duplicar$` | Inventarios - Criar | sim | sim | sim |
| /inventario | `^Excluir$` | Inventarios - Excluir | sim | sim | não |
| /transferencia | `^Nova transferência$` | Transferencias - Criar | sim | sim | sim |
| /transferencia | `^Duplicar$` | Transferencias - Criar | sim | sim | sim |
| /transferencia | `^Excluir$` | Transferencias - Excluir | sim | sim | não |
| /ordem-producao | `^Criar OP$` | Ordens de Producao - Criar | sim | sim | sim |
| /ordem-producao | `^Excluir a OP` | Ordens de Producao - Excluir | sim | sim | não |
| /ordem-producao | `^Reverter` | Ordens de Producao - Reverter | sim | sim | não |
| /ordem-producao | `^Concluir` | Ordens de Producao - Concluir | sim | sim | sim |
| /ordem-producao | `^Atualizar agora$` | Ordens de Producao - Sincronizar | sim | sim | não |
| /categoria-contabil | `^Nova categoria$` | Categorias Contabeis - Criar | sim | não | não |
| /categoria-contabil | `^Editar$` | Categorias Contabeis - Editar | sim | não | não |
| /categoria-contabil | `^Excluir$` | Categorias Contabeis - Excluir | sim | não | não |
| /produto | `^Novo produto$` | Produtos - Criar | sim | não | não |
| /produto | `^Editar produto$` | Produtos - Editar | sim | não | não |
| /produto | `^Excluir produto$` | Produtos - Excluir | sim | não | não |
| /produto | `^Atualizar tudo$` | Produtos - Sincronizar | sim | não | não |
| /familia | `^Nova família$` | Familias - Criar | sim | não | não |
| /familia | `^Editar$` | Familias - Editar | sim | não | não |
| /familia | `^Excluir$` | Familias - Excluir | sim | não | não |
| /familia | `^Puxar do Omie$` | perfil Admin | sim | não | não |
| /fornecedor | `^Novo fornecedor$` | Fornecedores - Criar | sim | não | não |
| /fornecedor | `^Editar$` | Fornecedores - Editar | sim | não | não |
| /fornecedor | `^Excluir$` | Fornecedores - Excluir | sim | não | não |
| /fornecedor | `^Puxar do Omie$` | perfil Admin | sim | não | não |
| /local-estoque | `^Novo local$` | Locais de Estoque - Criar | sim | não | não |
| /local-estoque | `^Editar$` | Locais de Estoque - Editar | sim | não | não |
| /local-estoque | `^Excluir$` | Locais de Estoque - Excluir | sim | não | não |
| /local-estoque | `^Sincronizar com Omie$` | perfil Admin | sim | não | não |
| /nota-fiscal | `^Atualizar agora$` | Notas Fiscais - Sincronizar | sim | sim | não |
| /contador | `^Fechar mês$` | Fechamento - Fechar mes | sim | sim | não |
| /usuario | `^(Novo usuário|Editar|Convidar por código)$` | Admin ou AdminLoja | sim | não | não |
| /cargo | `^Novo cargo$` | Admin ou AdminLoja | sim | não | não |
| /loja | `^Nova loja$` | perfil Admin | sim | não | não |

## APIs de leitura por endereço (GET)

| API | Regra | Bloqueio | dono | gerente | estoquista |
|---|---|---|---|---|---|
| /api/nota-fiscal/0/xml | Notas Fiscais | 403 | sim | sim | não |
| /api/nota-fiscal/0/danfe | Notas Fiscais | 403 | sim | sim | não |
| /api/nfe-saida/0/xml | dev + (Compras - Emitir NF-e ou Compras - Devolucao ao fornecedor ou Transferencias - Entre lojas) | 404 | sim | não | não |
| /api/nfe-saida/0/danfe | dev + (Compras - Emitir NF-e ou Compras - Devolucao ao fornecedor ou Transferencias - Entre lojas) | 404 | sim | não | não |
| /api/relatorio-mensal | Admin ou AdminLoja | 403 | sim | não | não |
| /api/relatorio-mensal/estrutura-pendente | perfil Admin | 403 | sim | não | não |
| /api/anexos/2 (loja 19) | Notas Fiscais | 403 | sim | sim | não |

## Dados pelo canal offline (`GET /api/offline/snapshot?tabela=`)

Quem deveria poder ler cada tabela, pela regra da tela que a mostra.

| Tabela | Regra | dono | gerente | estoquista |
|---|---|---|---|---|
| contas_pagar | dev + Financeiro - Contas a pagar | sim | não | não |
| contas_receber | dev + Financeiro - Contas a receber | sim | não | não |
| contas_correntes | dev + Financeiro - Contas correntes | sim | não | não |
| compras_proprio | Compras | sim | sim | não |
| notas_fiscais | Notas Fiscais | sim | sim | não |
| faturamento_importado | Admin ou AdminLoja | sim | não | não |
| margem_importada | Admin ou AdminLoja | sim | não | não |
| metas_faturamento | Admin ou AdminLoja | sim | não | não |

## O que a matriz NÃO cobre (honesto)

- Server actions e POST (`/api/sync/*`, `/api/estoque/kardex-omie`, `/api/anexos` POST, `/api/offline/{acao,linhas,mudancas,sessao,tabelas}`): só se chamam por POST/gravação; o robô é só leitura. Ficam sem prova em execução. `/api/offline/tabelas` até no GET faz `offline_compactar` (grava).
- `/api/cron/*`, `/api/integracao/*`, `/api/webhook`, `/api/correcoes/ingest`: autenticam por segredo/chave, não por cargo; não chamados (um GET sem segredo poderia disparar trabalho).
- Cargo Conferente e perfil AdminLoja: sem login de teste (o robô não cria). Dados por loja (um cargo ver outra loja) não entram.
- Botões só são conferidos nas telas que abrem para o login e que têm regra em `BOTOES`; botão que grava sem regra é listado como "sem regra" no relatório da rodada.
