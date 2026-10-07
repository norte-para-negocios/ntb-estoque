# Independência do Norte Estoque (substituir o Omie no controle de estoque) — Plano mestre vivo

> Documento vivo: cada rodada marca o que foi entregue, o que foi visto rodando e o que falta. Origem: pedidos do dono em 06/10/2026 (noite). Complementa o spec `docs/superpowers/specs/2026-10-06-modos-de-loja-estoque-proprio-design.md`.

## Princípio

O Norte Estoque passa a SUBSTITUIR o Omie no controle de estoque das lojas independentes. Tudo interno, tudo com histórico, tudo conectado ao Norte Vendas, tudo pesquisável e com navegação entre os registros. Lojas que usam Omie continuam como hoje (copiam o histórico do Omie para o ledger numa rodada posterior). Modo `omie` e `nenhum` nunca regridem.

## Requisitos (checklist de aceite)

| # | Requisito | Estado |
|---|---|---|
| R1 | Ledger, saldo por local, CMC, estorno, transferência | no ar, testado em banco e em venda real de teste (ODARA) |
| R2 | Telas existentes (Inventário, Ordem de Produção, Transferência, Movimentação, Notas Fiscais, Locais) funcionam sem Omie e mantêm todos os campos | Transferência e Locais, Inventário e Movimentações prontos nas branches; OP e NF em andamento; nada visto rodando |
| R3 | Nota fiscal de entrada puxada sozinha da SEFAZ e conferida com os produtos | em andamento (frente NF) |
| R4 | Histórico completo de OP, pesquisa forte em Movimentações | OP em andamento; Movimentações pronto na branch |
| R5 | **Conexão automática total Vendas ↔ Estoque:** loja criada num lado aparece no outro; produto criado/alterado num lado aparece no outro, sem checkbox, sem passo manual | planejado (frente SYNC) |
| R6 | **Cadastro de produto igual nos dois sistemas:** produto mãe com variações, grupos e subgrupos (árvore) criados por quem administra; Vendas e Estoque falam a mesma estrutura | planejado (frente SYNC) |
| R7 | **Relatórios completos:** faturamento e lucro (faturamento − CMV pelo custo do ledger no momento da venda) para lojas independentes, mantendo os filtros/drill dos relatórios atuais | planejado (frente REL) |
| R8 | **Validade** adaptada para lojas independentes: lote e validade na entrada (compra/produção), saldo por lote, FEFO, alertas de vencimento | planejado (frente VAL) |
| R9 | **Navegação entre registros:** em Movimentações filtrar só ordens de produção/notas/inventários/transferências/vendas e CLICAR para abrir o documento de origem; todo documento mostra seus movimentos; todos os registros pesquisáveis e exportáveis | parcial (detalhe do movimento pronto na branch INV); frente LINKS depois do merge |
| R10 | Modal de cadastro de loja grande (~70% da tela) com seções; locais de preparo livres (Cozinha, Bar, Pizzaria…) com Acompanhamento (KDS) ou Impressão direta; tipos Omie / próprio / sem estoque | Estoque pronto na branch; Vendas em andamento |
| R11 | Design bonito e consistente (kit teal no Estoque, azul-violeta Norte no Vendas), mobile OK, claro e escuro, capturas conferidas | pendente: nenhuma tela nova foi vista rodando em produção |
| R12 | Cópia do histórico do Omie para o ledger nas lojas Omie | adiada por decisão do dono |

## Arquitetura das frentes novas

### SYNC (R5 + R6) — conexão automática e cadastro unificado
- **Loja:** criar loja em qualquer painel já cria e liga a do outro (chave de integração, URL, modo) sem checkbox; editar nome/CNPJ/ativo propaga; o par fica visível nos dois lados com status da ligação.
- **Estrutura de catálogo no Estoque** (aditiva): `grupos_produto` (árvore: grupo → subgrupo → …, por loja), `produtos.grupo_id`, `produtos.produto_pai_codigo` (produto mãe) com variações como produtos filhos (código próprio, unidade base própria, mesma ficha técnica opcional), `atributos` livres da variação (tamanho, sabor…). A mãe não tem saldo; as variações têm.
- **Mapeamento com o Vendas:** produto mãe ↔ produto do cardápio; variações ↔ opções do grupo de opções (`product_options.omie_codigo` = código da variação) e categorias do Vendas ↔ grupos/subgrupos do Estoque (hoje o Vendas já tem `category_groups`).
- **Sincronização bidirecional automática e idempotente:** evento de criação/edição/inativação de produto, variação, grupo; fila de saída (outbox) com retry e reconciliação periódica; conflito resolvido por `updated_at` com a regra "quem alterou por último vence, exceto preço de venda (Vendas manda) e custo/unidade/código (Estoque manda)"; nada some em silêncio (tela de divergências).
- Produto criado só no Estoque aparece no Vendas como indisponível até ter categoria e preço; criado só no Vendas aparece no Estoque com código por tipo.

### REL (R7) — faturamento e lucro independentes
- Fato de vendas no Estoque alimentado pelo Vendas no fechamento (mesas/balcão): cupom, itens (produto, quantidade, preço, desconto), pagamentos, nota fiscal vinculada. Mesmas tabelas/contrato que os relatórios atuais leem (`fat_cupons*` no Contabo e `faturamento_importado`), para o relatório de Faturamento, Margem, Indicadores e Resumo funcionarem sem mudança de tela.
- **Lucro:** CMV por item = quantidade × custo no instante da baixa (já está em `estoque_movimentos.custo_unitario`/receita); margem por produto, família, grupo, dia, local; faturamento × compras; ponto de equilíbrio simples; relatórios exportáveis.

### VAL (R8) — validade e lotes
- `estoque_lotes` (loja, produto, local, lote, validade, saldo) alimentado por entrada de compra (lote e validade opcionais) e produção (validade por prazo do produto), baixa FEFO automática no ledger, alerta de vencimento (D-N), tela de Validade existente passa a ler lotes no modo próprio, relatório de perdas por vencimento.

### LINKS (R9) — navegação entre registros
- Movimentações com filtro "documento de origem" (OP, NF, transferência, inventário, venda, ajuste), link da linha para o documento e do documento para os movimentos; busca global (`busca-global`) cobre todos os registros; todo registro com histórico e exportação.

## Ordem e paralelismo
1. Em andamento: OP, NF (SEFAZ), modal Vendas. Prontos: Transferência/Locais, Inventário/Movimentações, modal Estoque.
2. Agora: SYNC e REL em paralelo (isolados por worktree, sem tocar telas em andamento).
3. Depois do merge das branches: VAL e LINKS; migrations 136–14x aplicadas na ordem; portão do Vendas; deploys fora do horário de serviço.
4. QA visual em produção com a ODARA (capturas claro/escuro/celular) e correção das telas; checklist R1–R12 revisado item a item com o dono.

## Regras de entrega
Modo `omie` idêntico a hoje (teste de regressão por frente); migrations aditivas, testadas com ROLLBACK e aplicadas por mim; Vendas só sobe com o portão passando; apps Windows/Android só por `scripts/release-apps.sh`; Omie nunca é escrito em teste; fiscal só em homologação; segredos só no cofre.
